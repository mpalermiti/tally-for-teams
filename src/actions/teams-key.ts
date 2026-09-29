import streamDeck, {
	SingletonAction,
	type Action,
	type DialAction,
	type KeyAction,
	type DidReceiveSettingsEvent,
	type FeedbackPayload,
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

	/** Settings and last-drawn image/feedback per visible key or dial, so redraws skip unchanged ones. */
	#settings = new Map<string, KeySettings>();
	#drawn = new Map<string, string>();

	constructor(protected readonly teams: TeamsClient) {
		super();
	}

	/** The Teams action this key performs. */
	protected abstract press(settings: KeySettings): Promise<RequestResult>;

	/** Touch-strip content when placed on a Stream Deck+ dial; keys without dial support return nothing. */
	protected dialFeedback(): FeedbackPayload | undefined {
		return undefined;
	}

	/** Runs a Teams request and flashes the key or dial if Teams refuses it. */
	protected async perform(action: KeyAction<KeySettings> | DialAction<KeySettings>, request: Promise<RequestResult>): Promise<void> {
		const result = await request;
		if (!result.ok) {
			streamDeck.logger.warn(`${this.kind}: ${result.message}`);
			await action.showAlert();
		}
	}

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

	override onKeyDown(ev: KeyDownEvent<KeySettings>): Promise<void> {
		return this.perform(ev.action, this.press(ev.payload.settings));
	}

	/** Redraws every visible instance of this key; called whenever the meeting changes. */
	async refresh(): Promise<void> {
		const draws: Promise<void>[] = [];
		this.actions.forEach((action) => draws.push(this.#draw(action)));
		await Promise.all(draws);
	}

	async #draw(action: Action<KeySettings>): Promise<void> {
		if (action.isKey()) {
			const settings = this.#settings.get(action.id) ?? {};
			const image = keyDataUrl(visualFor(this.kind, this.teams.snapshot, { reaction: settings.reaction }));
			if (this.#drawn.get(action.id) === image) return;
			this.#drawn.set(action.id, image);
			await action.setImage(image);
		} else if (action.isDial()) {
			const feedback = this.dialFeedback();
			if (!feedback) return;
			const signature = JSON.stringify(feedback);
			if (this.#drawn.get(action.id) === signature) return;
			this.#drawn.set(action.id, signature);
			await action.setFeedback(feedback);
		}
	}
}
