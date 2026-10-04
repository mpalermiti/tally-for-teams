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
const DESK = {
	width: 2800,
	depth: 900,
	thickness: 28,
	backZ: -600,
	frontZ: 300,
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
		camera.position.set(-116, 70, 330);
		camera.lookAt(0, 35, -10);
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

	scene.add(new THREE.HemisphereLight("#FFFFFF", "#DAD7D1", 0.76));
	const light = new THREE.DirectionalLight("#FFFFFF", 3.18);
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

	scene.add(createWall());
	scene.add(createCornerBlend());
	scene.add(createDeskSlab());
	scene.add(createDeskSheen());

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
	const centerZ = (DESK.frontZ + DESK.backZ) / 2;
	const body = new THREE.Mesh(
		new RoundedBoxGeometry(DESK.width, DESK.thickness, DESK.depth, 10, 5),
		new THREE.MeshStandardMaterial({
			map: woodTexture(),
			color: "#C9C9C5",
			roughness: 0.51,
			envMapIntensity: 0.2,
		}),
	);
	body.position.set(0, -DESK.thickness / 2, centerZ);
	body.receiveShadow = true;
	group.add(body);

	const top = new THREE.Mesh(
		new THREE.PlaneGeometry(DESK.width, DESK.depth),
		new THREE.MeshStandardMaterial({
			map: woodTexture(),
			color: "#C9C9C5",
			roughness: 0.5,
			envMapIntensity: 0.22,
		}),
	);
	top.rotation.x = -Math.PI / 2;
	top.position.set(0, 0.035, centerZ);
	top.receiveShadow = true;
	group.add(top);

	const frontEdge = new THREE.Mesh(
		new THREE.PlaneGeometry(DESK.width, DESK.thickness),
		new THREE.MeshStandardMaterial({
			map: woodTexture(),
			color: "#96928A",
			roughness: 0.54,
			envMapIntensity: 0.14,
		}),
	);
	frontEdge.position.set(0, -DESK.thickness / 2, DESK.frontZ + 0.35);
	frontEdge.rotation.x = 0;
	frontEdge.receiveShadow = true;
	group.add(frontEdge);
	return group;
}

function createWall() {
	const wall = new THREE.Mesh(
		new THREE.PlaneGeometry(5200, 1800),
		new THREE.MeshStandardMaterial({
			map: wallTexture(),
			color: "#FFFFFF",
			roughness: 0.9,
			envMapIntensity: 0.08,
		}),
	);
	wall.position.set(0, 720, DESK.backZ);
	wall.receiveShadow = true;
	return wall;
}

function createCornerBlend() {
	const blend = new THREE.Mesh(
		new THREE.PlaneGeometry(DESK.width, 220),
		new THREE.MeshBasicMaterial({
			map: cornerBlendTexture(),
			transparent: true,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	blend.rotation.x = Math.PI / 4;
	blend.position.set(0, 78, DESK.backZ + 78);
	blend.renderOrder = 3;
	return blend;
}

function createDeskBackOcclusion() {
	const shadow = new THREE.Mesh(
		new THREE.PlaneGeometry(DESK.width, 260),
		new THREE.MeshBasicMaterial({
			map: deskBackOcclusionTexture(),
			transparent: true,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.set(0, 0.08, DESK.backZ + 130);
	shadow.renderOrder = 1;
	return shadow;
}

function createDeskSheen() {
	const sheen = new THREE.Mesh(
		new THREE.PlaneGeometry(DESK.width * 0.82, 420),
		new THREE.MeshBasicMaterial({
			map: deskSheenTexture(),
			transparent: true,
			depthWrite: false,
			toneMapped: false,
		}),
	);
	sheen.rotation.x = -Math.PI / 2;
	sheen.rotation.z = THREE.MathUtils.degToRad(-1.5);
	sheen.position.set(110, 0.095, -86);
	sheen.renderOrder = 2;
	return sheen;
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
	canvas.width = 4096;
	canvas.height = 2048;
	const ctx = canvas.getContext("2d");
	const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
	gradient.addColorStop(0, "#E0D8CA");
	gradient.addColorStop(0.46, "#D9CEBD");
	gradient.addColorStop(1, "#D3C8B7");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	for (let y = -18; y < canvas.height + 18; y += 3 + rand() * 5.2) {
		const amp = 1.1 + rand() * 3.6;
		const alpha = 0.035 + rand() * 0.06;
		ctx.beginPath();
		ctx.moveTo(0, y);
		const phase = rand() * 6.28;
		for (let x = 0; x <= canvas.width; x += 72) {
			const wave = Math.sin(x * 0.0048 + phase) * amp + Math.sin(x * 0.015 + phase * 0.7) * (amp * 0.28);
			ctx.lineTo(x, y + wave + (rand() - 0.5) * 1.3);
		}
		ctx.strokeStyle = rand() > 0.68 ? `rgba(179,155,119,${alpha * 0.86})` : `rgba(244,235,221,${alpha * 0.94})`;
		ctx.lineWidth = 0.42 + rand() * 0.58;
		ctx.stroke();
	}

	for (let i = 0; i < 42; i++) {
		const y = rand() * canvas.height;
		const height = 2 + rand() * 7;
		const alpha = 0.022 + rand() * 0.032;
		const streak = ctx.createLinearGradient(0, y, canvas.width, y + height);
		streak.addColorStop(0, "rgba(198,174,137,0)");
		streak.addColorStop(0.18 + rand() * 0.2, `rgba(171,148,112,${alpha * 0.82})`);
		streak.addColorStop(0.74 + rand() * 0.18, `rgba(244,235,221,${alpha * 0.58})`);
		streak.addColorStop(1, "rgba(244,235,221,0)");
		ctx.fillStyle = streak;
		ctx.fillRect(0, y, canvas.width, height);
	}

	ctx.globalAlpha = 0.019;
	for (let i = 0; i < 12000; i++) {
		const warm = rand() > 0.45;
		ctx.fillStyle = warm ? "#B99D70" : "#EEE3D3";
		ctx.fillRect(rand() * canvas.width, rand() * canvas.height, 0.8 + rand() * 2.6, 0.55);
	}
	ctx.globalAlpha = 1;

	ctx.fillStyle = "rgba(218,207,190,0.055)";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(2.1, 1.15);
	texture.anisotropy = 16;
	return texture;
}

function wallTexture() {
	const rand = mulberry32(0x20261003);
	const canvas = document.createElement("canvas");
	canvas.width = 2400;
	canvas.height = 1600;
	const ctx = canvas.getContext("2d");
	const base = ctx.createLinearGradient(0, 0, 0, canvas.height);
	base.addColorStop(0, "#F7F5F0");
	base.addColorStop(0.58, WALL);
	base.addColorStop(1, "#EAE4DB");
	ctx.fillStyle = base;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const light = ctx.createRadialGradient(canvas.width * 0.58, canvas.height * 0.1, 0, canvas.width * 0.58, canvas.height * 0.1, canvas.width * 0.72);
	light.addColorStop(0, "rgba(255,255,255,0.44)");
	light.addColorStop(0.48, "rgba(255,255,255,0.18)");
	light.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = light;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const bottomFalloff = ctx.createLinearGradient(0, canvas.height * 0.56, 0, canvas.height);
	bottomFalloff.addColorStop(0, "rgba(216,208,195,0)");
	bottomFalloff.addColorStop(0.62, "rgba(216,208,195,0.06)");
	bottomFalloff.addColorStop(0.86, "rgba(202,193,178,0.105)");
	bottomFalloff.addColorStop(1, "rgba(192,181,164,0.16)");
	ctx.fillStyle = bottomFalloff;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const edgeFalloff = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.46, canvas.width * 0.12, canvas.width * 0.5, canvas.height * 0.52, canvas.width * 0.64);
	edgeFalloff.addColorStop(0, "rgba(0,0,0,0)");
	edgeFalloff.addColorStop(0.72, "rgba(0,0,0,0)");
	edgeFalloff.addColorStop(1, "rgba(185,176,162,0.1)");
	ctx.fillStyle = edgeFalloff;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	ctx.filter = "blur(44px)";
	ctx.globalAlpha = 0.035;
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

function deskBackOcclusionTexture() {
	const canvas = document.createElement("canvas");
	canvas.width = 2048;
	canvas.height = 256;
	const ctx = canvas.getContext("2d");
	const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
	gradient.addColorStop(0, "rgba(78,68,56,0.065)");
	gradient.addColorStop(0.24, "rgba(102,88,70,0.04)");
	gradient.addColorStop(0.72, "rgba(132,116,92,0.014)");
	gradient.addColorStop(1, "rgba(132,112,86,0)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.anisotropy = 8;
	return texture;
}

function deskSheenTexture() {
	const canvas = document.createElement("canvas");
	canvas.width = 2048;
	canvas.height = 512;
	const ctx = canvas.getContext("2d");
	const sheen = ctx.createRadialGradient(canvas.width * 0.44, canvas.height * 0.25, 0, canvas.width * 0.44, canvas.height * 0.25, canvas.width * 0.54);
	sheen.addColorStop(0, "rgba(255,255,255,0.038)");
	sheen.addColorStop(0.34, "rgba(255,255,255,0.018)");
	sheen.addColorStop(0.75, "rgba(255,255,255,0.006)");
	sheen.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = sheen;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

function cornerBlendTexture() {
	const canvas = document.createElement("canvas");
	canvas.width = 2048;
	canvas.height = 384;
	const ctx = canvas.getContext("2d");
	const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
	gradient.addColorStop(0, "rgba(235,228,217,0)");
	gradient.addColorStop(0.22, "rgba(218,207,190,0.04)");
	gradient.addColorStop(0.5, "rgba(241,236,226,0.065)");
	gradient.addColorStop(0.82, "rgba(249,247,241,0.032)");
	gradient.addColorStop(1, "rgba(249,247,241,0)");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
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
