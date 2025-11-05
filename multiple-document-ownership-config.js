import { MultipleDocumentSelection, log, error, setting, i18n } from './multiple-document-selection.js';

export const WithOwnershipConfig = (ConfigClass) => {
    class MultipleDocumentOwnershipConfig extends ConfigClass {

        static DEFAULT_OPTIONS = {
            form: {
                handler: MultipleDocumentOwnershipConfig.onSubmitForm
            }
        }
        constructor(object, options = {}) {
            super(object, options);
            this.documents = object.documents;
        }

        get title() {
            return game.i18n.format("OWNERSHIP.Title", { object: i18n("MultipleDocumentSelection.multiple-documents") });
        }

        getData(options) {
            // User permission levels
            let playerLevels = Object.entries(CONST.DOCUMENT_META_OWNERSHIP_LEVELS).map(([name, level]) => {
                return { level, label: i18n(`OWNERSHIP.${name}`) };
            });
            for (let [name, level] of Object.entries(CONST.DOCUMENT_OWNERSHIP_LEVELS)) {
                if ((level < 0)) continue;
                playerLevels.push({ level, label: i18n(`OWNERSHIP.${name}`) });
            }

            // Default permission levels
            const defaultLevels = foundry.utils.deepClone(playerLevels);
            defaultLevels.shift();

            // Player users
            const users = game.users.map(user => {
                return {
                    user,
                    level: CONST.DOCUMENT_META_OWNERSHIP_LEVELS?.NOCHANGE ?? "-1",
                    isAuthor: false
                };
            });

            // Construct and return the data object
            return {
                currentDefault: CONST.DOCUMENT_META_OWNERSHIP_LEVELS?.NOCHANGE ?? "-1",
                instructions: game.i18n.localize("OWNERSHIP.HintDocument"),
                defaultLevels,
                playerLevels,
                isFolder: false,
                users
            };
        }

        static async onSubmitForm(_event, _form, { object }) {
             if (!game.user.isGM) throw new Error("You do not have the ability to configure permissions.");

            const metaLevels = CONST.DOCUMENT_META_OWNERSHIP_LEVELS;
            const omit = metaLevels.NOCHANGE;
            const ownershipLevels = {};
            for (let [user, level] of Object.entries(object)) {
                if (level === omit) {
                    delete ownershipLevels[user];
                    continue;
                }
                ownershipLevels[user] = level;
            }

            let cls = getDocumentClass(this.documents[0].documentName);
            const updates = this.documents.map(d => {
                const ownership = foundry.utils.deepClone(d.ownership);
                for (let [k, v] of Object.entries(ownershipLevels)) {
                    if (v === metaLevels.DEFAULT) delete ownership[k];
                    else ownership[k] = v;
                }
                let data = { _id: d.id, ownership };
                return data;
            });

            MultipleDocumentSelection.clearAllTabs();

            return cls.updateDocuments(updates, { diff: false, recursive: false, noHook: true });
        }

        _canUserView() {
            return game.user.isGM;
        }

        get isEditable() {
            return game.user.isGM;
        }

        _getHeaderButtons() {
            const buttons = [
                {
                    label: "Close",
                    class: "close",
                    icon: "fas fa-times",
                    onclick: () => this.close()
                }
            ];
            for (let cls of this.constructor._getInheritanceChain()) {
                Hooks.call(`get${cls.name}HeaderButtons`, this, buttons);
            }
            return buttons;
        }
    }

    const constructorName = "MultipleDocumentOwnershipConfig";
    Object.defineProperty(MultipleDocumentOwnershipConfig.prototype.constructor, "name", { value: constructorName });
    return MultipleDocumentOwnershipConfig;
}