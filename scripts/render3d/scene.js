import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

try {
	const params = new URLSearchParams(location.search);
	const name = params.get("name") ?? "";
	const w = Number(params.get("w") ?? "0");
	const h = Number(params.get("h") ?? "0");
	const format = params.get("format") ?? "jpeg";
	const q = Number(params.get("q") ?? "0.92");

	await fetch("/faces.json").then((response) => response.json());

	const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(w, h, false);
	document.body.append(renderer.domElement);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color("#F5F5F7");
	const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
	camera.position.set(0, 0, 5);

	const light = new THREE.HemisphereLight(0xffffff, 0x999999, 2);
	scene.add(light);
	const box = new THREE.Mesh(
		new RoundedBoxGeometry(2.4, 1.2, 0.25, 6, 0.12),
		new THREE.MeshStandardMaterial({ color: "#8E8E93", roughness: 0.55 }),
	);
	scene.add(box);

	renderer.render(scene, camera);
	const blob = await new Promise((resolve, reject) => {
		renderer.domElement.toBlob(
			(value) => (value ? resolve(value) : reject(new Error("canvas.toBlob returned null"))),
			format === "png" ? "image/png" : "image/jpeg",
			q,
		);
	});
	await fetch(`/save/${encodeURIComponent(name)}`, { method: "POST", body: blob });
} catch (e) {
	await fetch("/error", { method: "POST", body: String(e instanceof Error ? (e.stack ?? e.message) : e) });
}
