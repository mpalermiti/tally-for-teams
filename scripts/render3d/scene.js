import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const PAPER = "#F5F5F7";
const BODY_WHITE = "#F4F2ED";
const WALL = "#F2EFE9";
const KEY_DARK = "#1A1A1C";
const WELL_DARK = "#08080A";
const RENDER_SCALE = 2;
const MM = 1;
const DEVICE = {
	width: 118 * MM,
	height: 84 * MM,
	depth: 21 * MM,
	radius: 7.5 * MM,
	tilt: THREE.MathUtils.degToRad(-33),
};
const KEY = {
	size: 15 * MM,
	gap: 4.3 * MM,
	bodyDepth: 1.4 * MM,
	screen: 13.8 * MM,
	well: 16.2 * MM,
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
	renderer.setSize(w * RENDER_SCALE, h * RENDER_SCALE, false);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.NeutralToneMapping;
	renderer.toneMappingExposure = shot === "floating" ? 1 : 0.91;
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

	const canvas = compositeFrame(renderer.domElement, w, h, shot);
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
	const camera = new THREE.PerspectiveCamera(26, w / h, 0.1, 1400);
	if (shot === "social") {
		camera.position.set(-116, 70, 330);
		camera.lookAt(70, 35, -10);
	} else {
		camera.position.set(-136, 76, 365);
		camera.lookAt(0, 35, -18);
	}
	return camera;
}

function createFloatingCamera(w, h) {
	const camera = new THREE.PerspectiveCamera(24, w / h, 0.1, 620);
	camera.position.set(0, 34, 218);
	camera.lookAt(2, 1, 0);
	return camera;
}

function buildRoomScene(scene, textures, shot) {
	const root = new THREE.Group();
	root.position.x = shot === "social" ? 104 : 0;
	root.position.z = shot === "social" ? 6 : 0;
	scene.add(root);

	scene.add(new THREE.HemisphereLight("#FFFFFF", "#D8D1C7", 0.72));
	const light = new THREE.DirectionalLight("#FFF7EC", 3.35);
	light.position.set(-150, 205, 155);
	light.target.position.set(4, 32, -14);
	light.castShadow = true;
	light.shadow.mapSize.set(4096, 4096);
	light.shadow.radius = 6;
	light.shadow.bias = -0.00008;
	light.shadow.camera.left = -120;
	light.shadow.camera.right = 150;
	light.shadow.camera.top = 145;
	light.shadow.camera.bottom = -36;
	light.shadow.camera.near = 85;
	light.shadow.camera.far = 405;
	scene.add(light, light.target);

	scene.add(createDeskSlab());
	scene.add(createWall());

	const device = createDevice(textures);
	device.position.y = 41.2;
	device.rotation.x = DEVICE.tilt;
	root.add(device);

	const stand = createStand();
	root.add(stand);

	const shadow = new THREE.Mesh(
		new THREE.PlaneGeometry(146, 90),
		new THREE.MeshBasicMaterial({
			map: blobTexture(1024, 540, 0.36),
			transparent: true,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.set(-2, 0.12, 3);
	shadow.renderOrder = 4;
	root.add(shadow);

	const castShadow = new THREE.Mesh(
		new THREE.PlaneGeometry(182, 82),
		new THREE.MeshBasicMaterial({
			map: blobTexture(1024, 480, 0.14),
			transparent: true,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	castShadow.rotation.x = -Math.PI / 2;
	castShadow.rotation.z = THREE.MathUtils.degToRad(-5);
	castShadow.position.set(16, 0.11, -28);
	castShadow.renderOrder = 3;
	root.add(castShadow);

	const cable = createCable(device);
	root.add(cable);
}

function createDeskSlab() {
	const group = new THREE.Group();
	const body = new THREE.Mesh(
		new RoundedBoxGeometry(1600, 28, 800, 8, 5),
		new THREE.MeshStandardMaterial({
			map: woodTexture(),
			color: "#EFE4D1",
			roughness: 0.55,
			envMapIntensity: 0.22,
		}),
	);
	body.position.set(0, -14, -200);
	body.receiveShadow = true;
	group.add(body);

	const top = new THREE.Mesh(
		new THREE.PlaneGeometry(1600, 800),
		new THREE.MeshStandardMaterial({
			map: woodTexture(),
			color: "#F4E8D6",
			roughness: 0.55,
			envMapIntensity: 0.16,
		}),
	);
	top.rotation.x = -Math.PI / 2;
	top.position.set(0, 0.035, -200);
	top.receiveShadow = true;
	group.add(top);

	const frontEdge = new THREE.Mesh(
		new THREE.PlaneGeometry(1600, 28),
		new THREE.MeshStandardMaterial({
			map: woodTexture(),
			color: "#D8BF97",
			roughness: 0.58,
			envMapIntensity: 0.12,
		}),
	);
	frontEdge.position.set(0, -14, 200.6);
	frontEdge.rotation.x = 0;
	frontEdge.receiveShadow = true;
	group.add(frontEdge);
	return group;
}

function createWall() {
	const wall = new THREE.Mesh(
		new THREE.PlaneGeometry(1900, 980),
		new THREE.MeshStandardMaterial({
			map: wallTexture(),
			color: "#FFFFFF",
			roughness: 0.9,
			envMapIntensity: 0.08,
		}),
	);
	wall.position.set(0, 365, -600);
	wall.receiveShadow = true;
	return wall;
}

function createDevice(textures) {
	const group = new THREE.Group();

	const bodyMaterial = new THREE.MeshPhysicalMaterial({
		color: "#F0EEE9",
		roughness: 0.45,
		clearcoat: 0.48,
		clearcoatRoughness: 0.36,
		envMapIntensity: 0.86,
	});
	const body = new THREE.Mesh(
		new RoundedBoxGeometry(DEVICE.width, DEVICE.height, DEVICE.depth, 10, DEVICE.radius),
		bodyMaterial,
	);
	body.castShadow = false;
	body.receiveShadow = true;
	group.add(body);

	const frontPlate = new THREE.Mesh(
		roundedRectGeometry(DEVICE.width - 8.8, DEVICE.height - 8.6, 4.2, 24),
		new THREE.MeshPhysicalMaterial({
			color: "#F6F4EF",
			roughness: 0.5,
			clearcoat: 0.28,
			clearcoatRoughness: 0.42,
			envMapIntensity: 0.68,
		}),
	);
	frontPlate.position.z = DEVICE.depth / 2 + 0.2;
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
	group.position.set(x, y, DEVICE.depth / 2 + 0.12);

	const well = new THREE.Mesh(
		new RoundedBoxGeometry(KEY.well, KEY.well, 0.72, 5, 2.2),
		new THREE.MeshStandardMaterial({
			color: WELL_DARK,
			roughness: 0.74,
			envMapIntensity: 0.2,
		}),
	);
	well.position.z = 0.04;
	well.receiveShadow = true;
	group.add(well);

	const cap = new THREE.Mesh(
		new RoundedBoxGeometry(KEY.size, KEY.size, KEY.bodyDepth, 7, 2.4),
		new THREE.MeshPhysicalMaterial({
			color: KEY_DARK,
			roughness: 0.22,
			clearcoat: 1,
			clearcoatRoughness: 0.11,
			envMapIntensity: 0.92,
		}),
	);
	cap.position.z = 0.58;
	cap.castShadow = false;
	cap.receiveShadow = true;
	group.add(cap);

	const screen = createScreen(texture);
	screen.position.z = 1.48;
	group.add(screen);

	return group;
}

function createScreen(texture) {
	const material = new THREE.MeshBasicMaterial({
		color: "#FFFFFF",
		map: texture,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -3,
		polygonOffsetUnits: -3,
		toneMapped: false,
	});
	const screen = new THREE.Mesh(roundedRectGeometry(KEY.screen, KEY.screen, 1.6, 24), material);
	screen.castShadow = false;
	screen.receiveShadow = false;
	screen.renderOrder = 20;
	return screen;
}

function createStand() {
	const group = new THREE.Group();
	const standMaterial = new THREE.MeshPhysicalMaterial({
		color: "#F2F0EA",
		roughness: 0.48,
		clearcoat: 0.42,
		clearcoatRoughness: 0.38,
		envMapIntensity: 0.76,
	});

	const wedge = new THREE.Mesh(createWedgeGeometry(92, 54, 78, 43), standMaterial);
	wedge.position.set(4, 19, -39);
	wedge.castShadow = false;
	wedge.receiveShadow = true;
	group.add(wedge);

	const foot = new THREE.Mesh(new RoundedBoxGeometry(118, 8.5, 88, 9, 5), standMaterial);
	foot.position.set(2, 4.25, -25);
	foot.castShadow = false;
	foot.receiveShadow = true;
	group.add(foot);

	const pad = new THREE.Mesh(
		new RoundedBoxGeometry(104, 1.1, 74, 5, 3.5),
		new THREE.MeshStandardMaterial({ color: "#D4CEC5", roughness: 0.78 }),
	);
	pad.position.set(2, 0.62, -25);
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
	device.updateMatrix();
	const start = new THREE.Vector3(-42, 30, -DEVICE.depth / 2 - 0.8).applyMatrix4(device.matrix);
	const curve = new THREE.CatmullRomCurve3([
		start,
		new THREE.Vector3(start.x - 8, 27, start.z - 30),
		new THREE.Vector3(-55, 6.2, -84),
		new THREE.Vector3(-102, 2.2, -108),
		new THREE.Vector3(-178, 1.85, -92),
		new THREE.Vector3(-245, 1.65, -132),
	]);
	const cable = new THREE.Mesh(
		new THREE.TubeGeometry(curve, 64, 1.75, 18, false),
		new THREE.MeshPhysicalMaterial({
			color: "#F7F5F0",
			roughness: 0.5,
			clearcoat: 0.34,
			clearcoatRoughness: 0.32,
		}),
	);
	cable.castShadow = true;
	cable.receiveShadow = true;
	return cable;
}

function buildFloatingScene(scene, textures) {
	const floorY = -34;
	scene.add(new THREE.HemisphereLight("#FFFFFF", "#D6D2CB", 1.18));
	const light = new THREE.DirectionalLight("#FFF2E1", 2.25);
	light.position.set(-78, 132, 112);
	light.target.position.set(0, 0, 0);
	light.castShadow = false;
	scene.add(light, light.target);

	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(240, 140),
		new THREE.MeshBasicMaterial({ color: PAPER, toneMapped: false }),
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = floorY - 0.04;
	floor.receiveShadow = false;
	scene.add(floor);

	const specs = [
		{ texture: textures.mute, position: [-7, 13, 3], scale: 1.9, rotation: [-5, -8, 4] },
		{ texture: textures.hand, position: [44, 4, -17], scale: 1.3, rotation: [-3, 9, -7] },
		{ texture: textures.timer, position: [16, -17, 19], scale: 1.1, rotation: [4, -6, 6] },
		{ texture: textures.camera, position: [-54, -16, -13], scale: 0.9, rotation: [7, 8, -9] },
		{ texture: textures.leave, position: [57, -21, 22], scale: 0.8, rotation: [3, -10, 8] },
	];

	specs.forEach((spec) => {
		const shadow = createFloatingShadow(spec.position, spec.scale, floorY);
		scene.add(shadow);

		const key = createFloatingKey(spec.texture);
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

function createFloatingKey(texture) {
	const group = new THREE.Group();
	const cap = new THREE.Mesh(
		new RoundedBoxGeometry(KEY.size, KEY.size, 1.9, 8, 2.4),
		new THREE.MeshPhysicalMaterial({
			color: KEY_DARK,
			roughness: 0.22,
			clearcoat: 1,
			clearcoatRoughness: 0.12,
			envMapIntensity: 0.92,
		}),
	);
	cap.position.z = 0;
	cap.castShadow = false;
	cap.receiveShadow = true;
	group.add(cap);

	const screen = createScreen(texture);
	screen.position.z = 1.1;
	group.add(screen);

	return group;
}

function createFloatingShadow(position, scale, floorY) {
	const height = Math.max(4, position[1] - floorY);
	const softness = THREE.MathUtils.clamp(height / 48, 0.42, 1.05);
	const shadow = new THREE.Mesh(
		new THREE.PlaneGeometry(1, 1),
		new THREE.MeshBasicMaterial({
			map: floatingShadowTexture(0.18 / softness),
			transparent: true,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.set(position[0] + 2.8 * softness, floorY + 0.08, position[2] - 3.6 * softness);
	shadow.scale.set(KEY.size * scale * (1.9 + softness * 0.58), KEY.size * scale * (0.74 + softness * 0.25), 1);
	shadow.renderOrder = 2;
	return shadow;
}

function compositeFrame(source, w, h, shot) {
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	ctx.drawImage(source, 0, 0, w * RENDER_SCALE, h * RENDER_SCALE, 0, 0, w, h);

	if (shot === "social") drawSocialText(ctx, w, h);
	applyVignette(ctx, w, h, shot === "floating" ? 0.045 : 0.07);
	return canvas;
}

function drawSocialText(ctx, w, h) {
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
}

function applyVignette(ctx, w, h, opacity) {
	const gradient = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.18, w * 0.5, h * 0.5, Math.max(w, h) * 0.62);
	gradient.addColorStop(0, "rgba(0,0,0,0)");
	gradient.addColorStop(0.68, "rgba(0,0,0,0)");
	gradient.addColorStop(1, `rgba(0,0,0,${opacity})`);
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, w, h);
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
	canvas.width = 3072;
	canvas.height = 1024;
	const ctx = canvas.getContext("2d");
	const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
	gradient.addColorStop(0, "#E4D0AC");
	gradient.addColorStop(0.48, "#E2CBA6");
	gradient.addColorStop(1, "#D8BF97");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.globalAlpha = 0.13;
	for (let i = 0; i < 230; i++) {
		const y = rand() * canvas.height;
		const amp = 1.4 + rand() * 4.5;
		ctx.beginPath();
		ctx.moveTo(0, y);
		const phase = rand() * 6.28;
		for (let x = 0; x <= canvas.width; x += 96) {
			ctx.lineTo(x, y + Math.sin(x * 0.006 + phase) * amp + (rand() - 0.5) * 2);
		}
		ctx.strokeStyle = rand() > 0.58 ? "#A98254" : "#F6E8CF";
		ctx.lineWidth = 0.35 + rand() * 1.1;
		ctx.stroke();
	}

	ctx.globalAlpha = 0.065;
	for (let i = 0; i < 6200; i++) {
		const v = Math.floor(178 + rand() * 48);
		ctx.fillStyle = `rgb(${v},${Math.floor(v * 0.87)},${Math.floor(v * 0.66)})`;
		ctx.fillRect(rand() * canvas.width, rand() * canvas.height, 1.2 + rand() * 2.8, 0.9);
	}

	ctx.globalAlpha = 0.035;
	for (let i = 0; i < 44; i++) {
		const y = rand() * canvas.height;
		const h = 8 + rand() * 34;
		const streak = ctx.createLinearGradient(0, y, canvas.width, y + h);
		streak.addColorStop(0, "rgba(255,255,255,0)");
		streak.addColorStop(0.18 + rand() * 0.18, "rgba(255,255,255,0.8)");
		streak.addColorStop(1, "rgba(145,105,65,0)");
		ctx.fillStyle = streak;
		ctx.fillRect(0, y, canvas.width, h);
	}
	ctx.globalAlpha = 1;

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(1.2, 1);
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

	const light = ctx.createLinearGradient(canvas.width * 0.56, 0, canvas.width, canvas.height);
	light.addColorStop(0, "rgba(255,255,255,0.3)");
	light.addColorStop(0.5, "rgba(255,255,255,0.08)");
	light.addColorStop(1, "rgba(213,205,194,0.05)");
	ctx.fillStyle = light;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const bottomFalloff = ctx.createLinearGradient(0, canvas.height * 0.62, 0, canvas.height);
	bottomFalloff.addColorStop(0, "rgba(216,208,195,0)");
	bottomFalloff.addColorStop(0.68, "rgba(216,208,195,0.08)");
	bottomFalloff.addColorStop(1, "rgba(196,185,169,0.18)");
	ctx.fillStyle = bottomFalloff;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	ctx.filter = "blur(44px)";
	ctx.globalAlpha = 0.04;
	ctx.translate(canvas.width * 0.68, -120);
	ctx.rotate(THREE.MathUtils.degToRad(9));
	for (let i = 0; i < 3; i++) {
		ctx.fillStyle = i % 2 === 0 ? "#FFFFFF" : "#D6D0C7";
		ctx.fillRect(i * 178, 0, 84, canvas.height * 1.22);
	}
	ctx.restore();

	ctx.globalAlpha = 0.022;
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

function floatingShadowTexture(opacity) {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 512;
	const ctx = canvas.getContext("2d");
	const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
	gradient.addColorStop(0, `rgba(0,0,0,${opacity})`);
	gradient.addColorStop(0.44, `rgba(0,0,0,${opacity * 0.48})`);
	gradient.addColorStop(0.78, `rgba(0,0,0,${opacity * 0.12})`);
	gradient.addColorStop(1, "rgba(0,0,0,0)");
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
