import streamDeck, {
	SingletonAction,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { keyDataUrl, visualFor, type KeyKind } from "../render/key";
import type { RequestResult, TeamsClient } from "../teams/client";
import type { Reaction } from "../teams/protocol";

export type KeySettings = { reaction?: Reaction };

/**
 * Shared behaviour for every Teams key: draw from the live meeting snapshot,
 * send one Teams action on press, and flash an alert if Teams refuses it.
 */
export abstract class TeamsKey extends SingletonAction<KeySettings> {
	abstract readonly kind: KeyKind;

	/** Settings and last-drawn image per visible key, so redraws skip unchanged keys. */
	#settings = new Map<string, KeySettings>();
	#drawn = new Map<string, string>();

	constructor(protected readonly teams: TeamsClient) {
		super();
	}

	/** The Teams action this key performs. */
	protected abstract press(settings: KeySettings): Promise<RequestResult>;

	override onWillAppear(ev: WillAppearEvent<KeySettings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		this.#drawn.delete(ev.action.id); // the device may have shown something else on this key meanwhile
		return this.#draw(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<KeySettings>): void {
		this.#settings.delete(ev.action.id);
		this.#drawn.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<KeySettings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		return this.#draw(ev.action);
	}

	override async onKeyDown(ev: KeyDownEvent<KeySettings>): Promise<void> {
		const result = await this.press(ev.payload.settings);
		if (!result.ok) {
			streamDeck.logger.warn(`${this.kind}: ${result.message}`);
			await ev.action.showAlert();
		}
	}

	/** Redraws every visible instance of this key; called whenever the meeting changes. */
	async refresh(): Promise<void> {
		const draws: Promise<void>[] = [];
		this.actions.forEach((action) => draws.push(this.#draw(action)));
		await Promise.all(draws);
	}

	async #draw(action: { id: string; isKey(): boolean }): Promise<void> {
		if (!action.isKey()) return;
		const settings = this.#settings.get(action.id) ?? {};
		const image = keyDataUrl(visualFor(this.kind, this.teams.snapshot, { reaction: settings.reaction }));
		if (this.#drawn.get(action.id) === image) return;
		this.#drawn.set(action.id, image);
		await (action as KeyAction<KeySettings>).setImage(image);
	}
}
