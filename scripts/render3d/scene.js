import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const PAPER = "#F5F5F7";
const BODY_WHITE = "#F4F2ED";
const WALL = "#F2EFE9";
const KEY_DARK = "#101012";
const WELL_DARK = "#08080A";
const MM = 1;
const DEVICE = {
	width: 118 * MM,
	height: 84 * MM,
	depth: 21 * MM,
	radius: 6 * MM,
	tilt: THREE.MathUtils.degToRad(-36),
};
const KEY = {
	size: 15 * MM,
	gap: 4.3 * MM,
	bodyDepth: 3.2 * MM,
	screen: 13.6 * MM,
	well: 17.4 * MM,
};
const GRID = {
	width: KEY.size * 5 + KEY.gap * 4,
	height: KEY.size * 3 + KEY.gap * 2,
	offsetY: -7.2 * MM,
};

try {
	const params = new URLSearchParams(location.search);
	const name = params.get("name") ?? "";
	const shot = params.get("shot") ?? "hero";
	const w = Number(params.get("w") ?? "0");
	const h = Number(params.get("h") ?? "0");
	const format = params.get("format") ?? "jpeg";
	const q = Number(params.get("q") ?? "0.92");

	const faces = await fetch("/faces.json").then((response) => {
		if (!response.ok) throw new Error(`faces.json ${response.status}`);
		return response.json();
	});

	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		preserveDrawingBuffer: true,
		powerPreference: "high-performance",
	});
	renderer.setPixelRatio(1);
	renderer.setSize(w, h, false);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.NeutralToneMapping;
	renderer.toneMappingExposure = shot === "floating" ? 1.14 : 1.18;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	document.body.append(renderer.domElement);

	const textureFactory = createTextureFactory(renderer);
	const deviceTextures = await Promise.all(faces.device.map((svg) => textureFactory(svg)));
	const floatingTextures = {
		mute: await textureFactory(faces.floating.mute),
		camera: await textureFactory(faces.floating.camera),
		hand: await textureFactory(faces.floating.hand),
		timer: await textureFactory(faces.floating.timer),
		leave: await textureFactory(faces.floating.leave),
	};

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(shot === "floating" ? PAPER : WALL);
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

	const camera = shot === "floating" ? createFloatingCamera(w, h) : createRoomCamera(w, h, shot);
	if (shot === "floating") {
		buildFloatingScene(scene, floatingTextures);
	} else {
		buildRoomScene(scene, deviceTextures, shot);
	}

	await renderStable(renderer, scene, camera);

	const canvas = shot === "social" ? socialComposite(renderer.domElement, w, h) : renderer.domElement;
	const blob = await new Promise((resolve, reject) => {
		canvas.toBlob(
			(value) => (value ? resolve(value) : reject(new Error("canvas.toBlob returned null"))),
			format === "png" ? "image/png" : "image/jpeg",
			q,
		);
	});
	await fetch(`/save/${encodeURIComponent(name)}`, { method: "POST", body: blob });
} catch (e) {
	await fetch("/error", { method: "POST", body: String(e instanceof Error ? (e.stack ?? e.message) : e) });
}

function createRoomCamera(w, h, shot) {
	const camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 900);
	if (shot === "social") {
		camera.position.set(108, 64, 405);
		camera.lookAt(54, 25, -6);
	} else {
		camera.position.set(98, 62, 385);
		camera.lookAt(0, 24, -3);
	}
	return camera;
}

function createFloatingCamera(w, h) {
	const camera = new THREE.PerspectiveCamera(25, w / h, 0.1, 600);
	camera.position.set(0, 32, 210);
	camera.lookAt(0, 4, 0);
	return camera;
}

function buildRoomScene(scene, textures, shot) {
	const root = new THREE.Group();
	root.position.x = shot === "social" ? 96 : 0;
	root.position.z = shot === "social" ? 3 : 0;
	scene.add(root);

	scene.add(new THREE.HemisphereLight("#FFFFFF", "#D8D1C7", 1.05));
	const light = new THREE.DirectionalLight("#FFF2DF", 3.6);
	light.position.set(-125, 180, 165);
	light.target.position.set(0, 24, -8);
	light.castShadow = true;
	light.shadow.mapSize.set(4096, 4096);
	light.shadow.radius = 7;
	light.shadow.bias = -0.00008;
	light.shadow.camera.left = -155;
	light.shadow.camera.right = 155;
	light.shadow.camera.top = 150;
	light.shadow.camera.bottom = -60;
	light.shadow.camera.near = 40;
	light.shadow.camera.far = 390;
	scene.add(light, light.target);

	const desk = new THREE.Mesh(
		new THREE.PlaneGeometry(700, 360),
		new THREE.MeshStandardMaterial({
			map: woodTexture(),
			roughness: 0.72,
			color: "#FFF8EF",
		}),
	);
	desk.rotation.x = -Math.PI / 2;
	desk.position.set(0, 0, 22);
	desk.receiveShadow = true;
	scene.add(desk);

	const wall = new THREE.Mesh(
		new THREE.PlaneGeometry(900, 330),
		new THREE.MeshStandardMaterial({
			map: wallTexture(),
			color: "#FFFFFF",
			roughness: 0.86,
		}),
	);
	wall.position.set(0, 92, -120);
	wall.receiveShadow = true;
	scene.add(wall);

	const device = createDevice(textures);
	device.position.y = 41.4;
	device.rotation.x = DEVICE.tilt;
	root.add(device);

	const stand = createStand();
	root.add(stand);

	const shadow = new THREE.Mesh(
		new THREE.PlaneGeometry(132, 78),
		new THREE.MeshBasicMaterial({
			map: blobTexture(1024, 520, 0.3),
			transparent: true,
			depthWrite: false,
		}),
	);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.set(1, 0.035, 0);
	root.add(shadow);

	const cable = createCable(device);
	root.add(cable);
}

function createDevice(textures) {
	const group = new THREE.Group();

	const bodyMaterial = new THREE.MeshPhysicalMaterial({
		color: "#F0EEE9",
		roughness: 0.52,
		clearcoat: 0.55,
		clearcoatRoughness: 0.38,
		envMapIntensity: 0.82,
	});
	const body = new THREE.Mesh(
		new RoundedBoxGeometry(DEVICE.width, DEVICE.height, DEVICE.depth, 7, DEVICE.radius),
		bodyMaterial,
	);
	body.castShadow = true;
	body.receiveShadow = true;
	group.add(body);

	const frontPlate = new THREE.Mesh(
		roundedRectGeometry(DEVICE.width - 9, DEVICE.height - 8, 4.4, 18),
		new THREE.MeshPhysicalMaterial({
			color: BODY_WHITE,
			roughness: 0.58,
			clearcoat: 0.35,
			clearcoatRoughness: 0.42,
			envMapIntensity: 0.76,
		}),
	);
	frontPlate.position.z = DEVICE.depth / 2 + 0.18;
	frontPlate.receiveShadow = true;
	group.add(frontPlate);

	textures.forEach((texture, index) => {
		const col = index % 5;
		const row = Math.floor(index / 5);
		const x = -GRID.width / 2 + KEY.size / 2 + col * (KEY.size + KEY.gap);
		const y = GRID.height / 2 - KEY.size / 2 - row * (KEY.size + KEY.gap) + GRID.offsetY;
		group.add(createDeviceKey(texture, x, y));
	});

	return group;
}

function createDeviceKey(texture, x, y) {
	const group = new THREE.Group();
	group.position.set(x, y, DEVICE.depth / 2 + 0.05);

	const well = new THREE.Mesh(
		new RoundedBoxGeometry(KEY.well, KEY.well, 0.7, 5, 2.3),
		new THREE.MeshStandardMaterial({
			color: WELL_DARK,
			roughness: 0.68,
			envMapIntensity: 0.2,
		}),
	);
	well.position.z = 0.03;
	well.receiveShadow = true;
	group.add(well);

	const cap = new THREE.Mesh(
		new RoundedBoxGeometry(KEY.size, KEY.size, KEY.bodyDepth, 7, 2.4),
		new THREE.MeshPhysicalMaterial({
			color: KEY_DARK,
			roughness: 0.31,
			clearcoat: 0.85,
			clearcoatRoughness: 0.18,
			envMapIntensity: 0.82,
		}),
	);
	cap.position.z = 1.48;
	cap.castShadow = true;
	cap.receiveShadow = true;
	group.add(cap);

	const screen = createScreen(texture, 0.36, 0.065);
	screen.position.z = 3.35;
	group.add(screen);

	return group;
}

function createScreen(texture, emissiveIntensity, glareOpacity = 0.1) {
	const material = new THREE.MeshPhysicalMaterial({
		color: "#FFFFFF",
		map: texture,
		emissive: "#FFFFFF",
		emissiveMap: texture,
		emissiveIntensity,
		roughness: 0.2,
		metalness: 0,
		clearcoat: 1,
		clearcoatRoughness: 0.08,
		envMapIntensity: 0.65,
	});
	const screen = new THREE.Mesh(roundedRectGeometry(KEY.screen, KEY.screen, 2.2, 24), material);
	screen.castShadow = false;
	screen.receiveShadow = false;

	const glare = new THREE.Mesh(
		roundedRectGeometry(KEY.screen * 0.84, KEY.screen * 0.42, 1.8, 18),
		new THREE.MeshBasicMaterial({
			map: glareTexture(),
			transparent: true,
			opacity: glareOpacity,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		}),
	);
	glare.position.set(-KEY.screen * 0.05, KEY.screen * 0.16, 0.018);
	screen.add(glare);

	return screen;
}

function createStand() {
	const group = new THREE.Group();
	const standMaterial = new THREE.MeshPhysicalMaterial({
		color: BODY_WHITE,
		roughness: 0.54,
		clearcoat: 0.45,
		clearcoatRoughness: 0.38,
		envMapIntensity: 0.7,
	});

	const wedge = new THREE.Mesh(createWedgeGeometry(98, 52, 74, 42), standMaterial);
	wedge.position.set(0, 20, -38);
	wedge.castShadow = true;
	wedge.receiveShadow = true;
	group.add(wedge);

	const foot = new THREE.Mesh(new RoundedBoxGeometry(116, 9, 86, 8, 5), standMaterial);
	foot.position.set(0, 4.5, -25);
	foot.castShadow = true;
	foot.receiveShadow = true;
	group.add(foot);

	const pad = new THREE.Mesh(
		new RoundedBoxGeometry(102, 1.1, 72, 5, 3.5),
		new THREE.MeshStandardMaterial({ color: "#D5D0C8", roughness: 0.78 }),
	);
	pad.position.set(0, 0.65, -25);
	pad.receiveShadow = true;
	group.add(pad);

	return group;
}

function createWedgeGeometry(width, height, depth, lean) {
	const x = width / 2;
	const y0 = 0;
	const y1 = height;
	const zFront = depth / 2;
	const zBack = -depth / 2;
	const zTop = zBack + lean;
	const vertices = new Float32Array([
		-x, y0, zFront, x, y0, zFront, x, y0, zBack, -x, y0, zBack,
		-x, y1, zTop, x, y1, zTop,
	]);
	const indices = [
		0, 1, 2, 0, 2, 3,
		0, 4, 5, 0, 5, 1,
		3, 2, 5, 3, 5, 4,
		0, 3, 4, 0, 4, 1,
		1, 5, 2,
	];
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

function createCable(device) {
	device.updateMatrixWorld(true);
	const start = device.localToWorld(new THREE.Vector3(-23, 29, -DEVICE.depth / 2 - 0.5));
	const curve = new THREE.CatmullRomCurve3([
		new THREE.Vector3(start.x, start.y, start.z),
		new THREE.Vector3(start.x - 6, 31, start.z - 28),
		new THREE.Vector3(-34, 5.2, -64),
		new THREE.Vector3(-78, 2.2, -76),
		new THREE.Vector3(-146, 1.8, -54),
	]);
	const cable = new THREE.Mesh(
		new THREE.TubeGeometry(curve, 80, 1.55, 14, false),
		new THREE.MeshPhysicalMaterial({
			color: "#F7F5F0",
			roughness: 0.58,
			clearcoat: 0.28,
			clearcoatRoughness: 0.35,
		}),
	);
	cable.castShadow = true;
	cable.receiveShadow = true;
	return cable;
}

function buildFloatingScene(scene, textures) {
	scene.add(new THREE.HemisphereLight("#FFFFFF", "#D6D2CB", 1.45));
	const light = new THREE.DirectionalLight("#FFF2E1", 3.3);
	light.position.set(-78, 132, 112);
	light.target.position.set(0, 0, 0);
	light.castShadow = true;
	light.shadow.mapSize.set(4096, 4096);
	light.shadow.radius = 14;
	light.shadow.bias = -0.00008;
	light.shadow.camera.left = -120;
	light.shadow.camera.right = 120;
	light.shadow.camera.top = 90;
	light.shadow.camera.bottom = -90;
	light.shadow.camera.near = 40;
	light.shadow.camera.far = 270;
	scene.add(light, light.target);

	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(240, 140),
		new THREE.ShadowMaterial({ color: "#1D1D1F", opacity: 0.08 }),
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -31;
	floor.receiveShadow = true;
	scene.add(floor);

	const specs = [
		{ texture: textures.mute, position: [-10, 13, 4], scale: 1.9, rotation: [-6, -10, 4], glow: 0.5 },
		{ texture: textures.hand, position: [44, 8, -18], scale: 1.28, rotation: [-4, 10, -7], glow: 0.43 },
		{ texture: textures.timer, position: [17, -18, 20], scale: 1.08, rotation: [4, -6, 7], glow: 0.36 },
		{ texture: textures.camera, position: [-53, -17, -16], scale: 0.92, rotation: [8, 9, -10], glow: 0.46 },
		{ texture: textures.leave, position: [55, -20, 22], scale: 0.82, rotation: [3, -12, 8], glow: 0.48 },
	];

	specs.forEach((spec) => {
		const key = createFloatingKey(spec.texture, spec.glow);
		key.position.fromArray(spec.position);
		key.scale.setScalar(spec.scale);
		key.rotation.set(
			THREE.MathUtils.degToRad(spec.rotation[0]),
			THREE.MathUtils.degToRad(spec.rotation[1]),
			THREE.MathUtils.degToRad(spec.rotation[2]),
		);
		scene.add(key);
	});
}

function createFloatingKey(texture, glow) {
	const group = new THREE.Group();
	const cap = new THREE.Mesh(
		new RoundedBoxGeometry(KEY.size, KEY.size, 4.1, 9, 2.8),
		new THREE.MeshPhysicalMaterial({
			color: "#141416",
			roughness: 0.25,
			clearcoat: 1,
			clearcoatRoughness: 0.12,
			envMapIntensity: 0.92,
		}),
	);
	cap.position.z = 0;
	cap.castShadow = true;
	cap.receiveShadow = true;
	group.add(cap);

	const screen = createScreen(texture, glow, 0.12);
	screen.position.z = 2.32;
	group.add(screen);

	return group;
}

function socialComposite(source, w, h) {
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	ctx.drawImage(source, 0, 0, w, h);

	const fade = ctx.createLinearGradient(0, 0, w * 0.52, 0);
	fade.addColorStop(0, "rgba(245,245,247,0.84)");
	fade.addColorStop(0.72, "rgba(245,245,247,0.42)");
	fade.addColorStop(1, "rgba(245,245,247,0)");
	ctx.fillStyle = fade;
	ctx.fillRect(0, 0, w * 0.56, h);

	ctx.fillStyle = "#1D1D1F";
	ctx.font = '600 64px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
	ctx.textBaseline = "alphabetic";
	ctx.fillText("Tally for Teams", 82, 244);
	ctx.fillStyle = "#6E6E73";
	ctx.font = '400 28px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
	ctx.fillText("Live Microsoft Teams controls", 84, 300);
	ctx.fillText("for Stream Deck on Mac.", 84, 338);
	return canvas;
}

async function createSvgTexture(svg, renderer) {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 512;
	const ctx = canvas.getContext("2d", { alpha: true });
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	const img = new Image();
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	try {
		img.src = url;
		await img.decode();
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	} finally {
		URL.revokeObjectURL(url);
	}

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	return texture;
}

function createTextureFactory(renderer) {
	const cache = new Map();
	return async (svg) => {
		if (!cache.has(svg)) cache.set(svg, createSvgTexture(svg, renderer));
		return cache.get(svg);
	};
}

function roundedRectGeometry(width, height, radius, segments = 12) {
	const shape = new THREE.Shape();
	const x = -width / 2;
	const y = -height / 2;
	const r = Math.min(radius, width / 2, height / 2);
	shape.moveTo(x + r, y);
	shape.lineTo(x + width - r, y);
	shape.quadraticCurveTo(x + width, y, x + width, y + r);
	shape.lineTo(x + width, y + height - r);
	shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
	shape.lineTo(x + r, y + height);
	shape.quadraticCurveTo(x, y + height, x, y + height - r);
	shape.lineTo(x, y + r);
	shape.quadraticCurveTo(x, y, x + r, y);
	const geometry = new THREE.ShapeGeometry(shape, segments);
	const uv = geometry.attributes.uv;
	for (let i = 0; i < uv.count; i++) {
		const px = geometry.attributes.position.getX(i);
		const py = geometry.attributes.position.getY(i);
		uv.setXY(i, (px + width / 2) / width, (py + height / 2) / height);
	}
	return geometry;
}

function mulberry32(seed) {
	return () => {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function woodTexture() {
	const rand = mulberry32(0x54414c4c);
	const canvas = document.createElement("canvas");
	canvas.width = 2048;
	canvas.height = 1024;
	const ctx = canvas.getContext("2d");
	const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
	gradient.addColorStop(0, "#EADFCC");
	gradient.addColorStop(0.52, "#E4D4BE");
	gradient.addColorStop(1, "#D9C5AB");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.globalAlpha = 0.11;
	for (let i = 0; i < 170; i++) {
		const y = rand() * canvas.height;
		const amp = 2 + rand() * 5;
		ctx.beginPath();
		ctx.moveTo(0, y);
		for (let x = 0; x <= canvas.width; x += 90) {
			ctx.lineTo(x, y + Math.sin(x * 0.008 + rand() * 2.5) * amp + (rand() - 0.5) * 3);
		}
		ctx.strokeStyle = rand() > 0.55 ? "#B99365" : "#FFFFFF";
		ctx.lineWidth = 0.45 + rand() * 1.4;
		ctx.stroke();
	}

	ctx.globalAlpha = 0.055;
	for (let i = 0; i < 4200; i++) {
		const v = Math.floor(190 + rand() * 45);
		ctx.fillStyle = `rgb(${v},${Math.floor(v * 0.92)},${Math.floor(v * 0.78)})`;
		ctx.fillRect(rand() * canvas.width, rand() * canvas.height, 1.1, 1.1);
	}
	ctx.globalAlpha = 1;

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(1.6, 1);
	texture.anisotropy = 16;
	return texture;
}

function wallTexture() {
	const rand = mulberry32(0x20261003);
	const canvas = document.createElement("canvas");
	canvas.width = 1600;
	canvas.height = 1000;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = WALL;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const light = ctx.createLinearGradient(canvas.width * 0.58, 0, canvas.width, canvas.height);
	light.addColorStop(0, "rgba(255,255,255,0.44)");
	light.addColorStop(0.45, "rgba(255,255,255,0.12)");
	light.addColorStop(1, "rgba(213,205,194,0.08)");
	ctx.fillStyle = light;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	ctx.filter = "blur(32px)";
	ctx.globalAlpha = 0.18;
	ctx.translate(canvas.width * 0.68, -120);
	ctx.rotate(THREE.MathUtils.degToRad(9));
	for (let i = 0; i < 3; i++) {
		ctx.fillStyle = i % 2 === 0 ? "#FFFFFF" : "#D6D0C7";
		ctx.fillRect(i * 170, 0, 88, canvas.height * 1.22);
	}
	ctx.restore();

	ctx.globalAlpha = 0.026;
	for (let i = 0; i < 6000; i++) {
		const v = Math.floor(218 + rand() * 24);
		ctx.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
		ctx.fillRect(rand() * canvas.width, rand() * canvas.height, 1, 1);
	}
	ctx.globalAlpha = 1;

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

function blobTexture(width, height, opacity) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	const gradient = ctx.createRadialGradient(width * 0.5, height * 0.54, 0, width * 0.5, height * 0.54, width * 0.5);
	gradient.addColorStop(0, `rgba(23,23,25,${opacity})`);
	gradient.addColorStop(0.38, `rgba(23,23,25,${opacity * 0.5})`);
	gradient.addColorStop(0.72, `rgba(23,23,25,${opacity * 0.12})`);
	gradient.addColorStop(1, "rgba(23,23,25,0)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

function glareTexture() {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 220;
	const ctx = canvas.getContext("2d");
	const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
	gradient.addColorStop(0, "rgba(255,255,255,0.52)");
	gradient.addColorStop(0.32, "rgba(255,255,255,0.16)");
	gradient.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

async function renderStable(renderer, scene, camera) {
	for (let i = 0; i < 3; i++) {
		renderer.render(scene, camera);
		await new Promise((resolve) => requestAnimationFrame(resolve));
	}
}
