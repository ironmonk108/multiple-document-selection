import { i18n } from "./multiple-document-selection.js";

export const registerSettings = function () {
	// Register any custom module settings here
	let modulename = "multiple-document-selection";

	game.settings.register(modulename, "long-press", {
		name: i18n("MultipleDocumentSelection.long-press.name"),
		hint: i18n("MultipleDocumentSelection.long-press.hint"),
		scope: "world",
		config: true,
		default: 1,
		type: Number,
	});
}