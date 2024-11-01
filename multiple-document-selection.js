import { registerSettings } from "./settings.js";
import { WithOwnershipConfig } from "./multiple-document-ownership-config.js";

export let debug = (...args) => {
    if (debugEnabled > 1) console.log("DEBUG: multiple-document-selection | ", ...args);
};
export let log = (...args) => console.log("multiple-document-selection | ", ...args);
export let warn = (...args) => {
    if (debugEnabled > 0) console.warn("multiple-document-selection | ", ...args);
};
export let error = (...args) => console.error("multiple-document-selection | ", ...args);
export let i18n = key => {
    return game.i18n.localize(key);
};

export let setting = key => {
    return game.settings.get("multiple-document-selection", key);
};

export let patchFunc = (prop, func, type = "WRAPPER") => {
    let nonLibWrapper = () => {
        const oldFunc = eval(prop);
        eval(`${prop} = function (event) {
            return func.call(this, ${type != "OVERRIDE" ? "oldFunc.bind(this)," : ""} ...arguments);
        }`);
    }
    if (game.modules.get("lib-wrapper")?.active) {
        try {
            libWrapper.register("monks-enhanced-journal", prop, func, type);
        } catch (e) {
            nonLibWrapper();
        }
    } else {
        nonLibWrapper();
    }
}

export class MultipleDocumentSelection {
    static app = null;
    static compendiums = [];

    static async init() {
        log("initializing");

        if (game.modules.get("lib-wrapper")?.active) {
            libWrapper.ignore_conflicts("multiple-document-selection", "monks-scene-navigation", "SceneDirectory.prototype._onClickEntryName");
            libWrapper.ignore_conflicts("multiple-document-selection", "monks-common-display", "ActorDirectory.prototype._onClickEntryName");
        }

        game.MultipleDocumentSelection = MultipleDocumentSelection;

        registerSettings();

        let additionalDirectories = [];
        Hooks.callAll("MultipleDocumentSelection.ready", additionalDirectories);

        let clickEntryName = async function (wrapped, ...args) {
            let event = args[0];
            if (event.ctrlKey && !this._groupSelect) {
                delete this._startPointerDown;
                this._groupSelect = new Set();
                if (this instanceof Compendium) {
                    MultipleDocumentSelection.compendiums.push(this);
                }
                $(this.popOut ? $('.sidebar-tab,.compendium.directory', this.element) : this.element).addClass("multiple-select");
            }

            if (this._groupSelect || this._startPointerDown) {
                event.preventDefault();
                const documentId = event.currentTarget.closest(".document").dataset.documentId;

                if (this._groupSelect.has(documentId)) {
                    //remove the document
                    MultipleDocumentSelection.removeDocument(this, documentId);
                } else {
                    //add the document
                    if (event.shiftKey && MultipleDocumentSelection._lastId) {
                        let elem1 = $(`.document[data-document-id="${documentId}"]`, this.element);
                        let elem2 = $(`.document[data-document-id="${MultipleDocumentSelection._lastId}"]`, elem1.parent());

                        if (elem2.length) {
                            if (elem2.index() < elem1.index()) {
                                let temp = elem2;
                                elem2 = elem1;
                                elem1 = temp;
                            }
                            let elements = elem1.nextUntil(elem2, 'li');

                            for (let elem of elements) {
                                MultipleDocumentSelection.addDocument(this, elem.dataset.documentId);
                            }
                        }

                    }
                    MultipleDocumentSelection.addDocument(this, documentId);
                }
            } else
                return wrapped(...args);
        }

        if (game.modules.get("lib-wrapper")?.active) {
            libWrapper.register("multiple-document-selection", "ActorDirectory.prototype._onClickEntryName", clickEntryName, "MIXED");
            libWrapper.register("multiple-document-selection", "CardsDirectory.prototype._onClickEntryName", clickEntryName, "MIXED");
            libWrapper.register("multiple-document-selection", "ItemDirectory.prototype._onClickEntryName", clickEntryName, "MIXED");
            libWrapper.register("multiple-document-selection", "JournalDirectory.prototype._onClickEntryName", clickEntryName, "MIXED");
            libWrapper.register("multiple-document-selection", "SceneDirectory.prototype._onClickEntryName", clickEntryName, "MIXED");
            libWrapper.register("multiple-document-selection", "RollTableDirectory.prototype._onClickEntryName", clickEntryName, "MIXED");
            libWrapper.register("multiple-document-selection", "MacroDirectory.prototype._onClickEntryName", clickEntryName, "MIXED");
            libWrapper.register("multiple-document-selection", "Compendium.prototype._onClickEntryName", clickEntryName, "MIXED");
        } else {
            let directories = [ActorDirectory, CardsDirectory, ItemDirectory, JournalDirectory, SceneDirectory, RollTableDirectory, MacroDirectory, Compendium];
            for (let dir of directories) {
                const oldClickEntryName = dir.prototype._onClickEntryName;
                dir.prototype._onClickEntryName = function (event) {
                    return clickEntryName.call(this, oldClickEntryName.bind(this), ...arguments);
                }
            }
        }
        for (let dir of additionalDirectories) {
            const oldClickEntryName = dir.prototype._onClickEntryName;
            dir.prototype._onClickEntryName = function (event) {
                return clickEntryName.call(this, oldClickEntryName.bind(this), ...arguments);
            }
        }
        

        let onDropFolder = async function (wrapped, ...args) {
            const data = TextEditor.getDragEventData(event);

            if (this._groupSelect) {
                let event = args[0];
                event.preventDefault();

                const cls = this.constructor.documentName;
                const data = TextEditor.getDragEventData(event);
                if (!data.type) return;
                const target = event.target.closest(".directory-item") || null;

                // Call the drop handler
                if (data.type == cls || (cls == "Playlist" && data.type == "PlaylistSound")) {
                    for (let id of this._groupSelect) {
                        if (data.type == "PlaylistSound") {
                            const li = $(`.sound[data-sound-id="${id}"]`, this.element);
                            const playlistId = li.parents(".playlist").data("document-id");
                            const playlist = game.playlists.get(playlistId);
                            const sound = playlist.sounds.get(id);
                            let docData = foundry.utils.mergeObject(data, { uuid: sound.uuid });

                            let dragEvent = {
                                target: event.target,
                                dataTransfer: new DataTransfer(),
                                type: event.type
                            };
                            dragEvent.dataTransfer.setData("text/plain", JSON.stringify(docData));

                            await wrapped(dragEvent);
                        } else {
                            let document = this.constructor.collection.get(id);
                            let docData = foundry.utils.mergeObject(data, { uuid: document.uuid });
                            if (docData.type == "Tile") delete docData.data;
                            await this._handleDroppedEntry(target, docData);
                        }
                    }
                    MultipleDocumentSelection.clearTab(this);
                } else
                    return wrapped(...args);
            } else if (data.groupSelect) {
                // Dropping multiple files here
                let groupSelect = foundry.utils.duplicate(data.groupSelect);
                delete data.groupSelect;
                let uuid = data.uuid.substr(0, data.uuid.length - 16);
                const target = event.target.closest(".directory-item") || null;
                for (let groupFile of groupSelect) {
                    let dropData = {
                        type: data.type,
                        uuid : `${uuid}${groupFile}`
                    }
                    this._handleDroppedEntry(target, dropData);
                }
            } else
                return wrapped(...args);
        }

        if (game.modules.get("lib-wrapper")?.active) {
            libWrapper.register("multiple-document-selection", "ActorDirectory.prototype._onDrop", onDropFolder, "MIXED");
            libWrapper.register("multiple-document-selection", "CardsDirectory.prototype._onDrop", onDropFolder, "MIXED");
            libWrapper.register("multiple-document-selection", "ItemDirectory.prototype._onDrop", onDropFolder, "MIXED");
            libWrapper.register("multiple-document-selection", "JournalDirectory.prototype._onDrop", onDropFolder, "MIXED");
            libWrapper.register("multiple-document-selection", "PlaylistDirectory.prototype._onDrop", onDropFolder, "MIXED");
            libWrapper.register("multiple-document-selection", "SceneDirectory.prototype._onDrop", onDropFolder, "MIXED");
            libWrapper.register("multiple-document-selection", "RollTableDirectory.prototype._onDrop", onDropFolder, "MIXED");
            libWrapper.register("multiple-document-selection", "MacroDirectory.prototype._onDrop", onDropFolder, "MIXED");
            libWrapper.register("multiple-document-selection", "Compendium.prototype._onDrop", onDropFolder, "MIXED");
        } else {
            for (let dir of [ActorDirectory, CardsDirectory, ItemDirectory, JournalDirectory, PlaylistDirectory, SceneDirectory, RollTableDirectory, MacroDirectory, Compendium]) {
                const oldOnDrop = dir.prototype._onDrop;
                dir.prototype._onDrop = function (event) {
                    return onDropFolder.call(this, oldOnDrop.bind(this), ...arguments);
                }
            }
        }
        for (let dir of additionalDirectories) {
            const oldOnDrop = dir.prototype._onDrop;
            dir.prototype._onDrop = function (event) {
                return onDropFolder.call(this, oldOnDrop.bind(this), ...arguments);
            }
        }

        let onDragStart = async function (wrapped, ...args) {
            if (!this._groupSelect?.size && this._startPointerDown) {
                window.clearTimeout(this._startPointerDown);
                delete this._startPointerDown;
            }

            let result = wrapped(...args);

            if (this._groupSelect?.size) {
                let [event] = args;
                let data;
                try {
                    data = JSON.parse(event.dataTransfer.getData('text/plain'));

                    data.groupSelect = Array.from(this._groupSelect);
                    event.dataTransfer.setData("text/plain", JSON.stringify(data));

                    if (data.uuid) {
                        let parts = data.uuid.split(".");
                        if (parts.length) {
                            let id = parts[parts.length - 1];
                            if (!this._groupSelect.has(id)) {
                                MultipleDocumentSelection.clearTab(this);
                            }
                        }
                    }
                }
                catch (err) { }
            }

            return result;
        }

        if (game.modules.get("lib-wrapper")?.active) {
            libWrapper.register("multiple-document-selection", "ActorDirectory.prototype._onDragStart", onDragStart, "WRAPPER");
            libWrapper.register("multiple-document-selection", "CardsDirectory.prototype._onDragStart", onDragStart, "WRAPPER");
            libWrapper.register("multiple-document-selection", "ItemDirectory.prototype._onDragStart", onDragStart, "WRAPPER");
            libWrapper.register("multiple-document-selection", "JournalDirectory.prototype._onDragStart", onDragStart, "WRAPPER");
            libWrapper.register("multiple-document-selection", "PlaylistDirectory.prototype._onDragStart", onDragStart, "WRAPPER");
            libWrapper.register("multiple-document-selection", "SceneDirectory.prototype._onDragStart", onDragStart, "WRAPPER");
            libWrapper.register("multiple-document-selection", "RollTableDirectory.prototype._onDragStart", onDragStart, "WRAPPER");
            libWrapper.register("multiple-document-selection", "MacroDirectory.prototype._onDragStart", onDragStart, "WRAPPER");
            libWrapper.register("multiple-document-selection", "Compendium.prototype._onDragStart", onDragStart, "WRAPPER");
        } else {
            for (let dir of [ActorDirectory, CardsDirectory, ItemDirectory, JournalDirectory, PlaylistDirectory, SceneDirectory, RollTableDirectory, MacroDirectory, Compendium]) {
                const oldDragStart = dir.prototype._onDragStart;
                dir.prototype._onDragStart = function (event) {
                    return onDragStart.call(this, oldDragStart.bind(this), ...arguments);
                }
            }
        }
        for (let dir of additionalDirectories) {
            const oldDragStart = dir.prototype._onDragStart;
            dir.prototype._onDragStart = function (event) {
                return onDragStart.call(this, oldDragStart.bind(this), ...arguments);
            }
        }

        let importFromJSON = async function (wrapped, ...args) {
            let json = args[0];
            let data = JSON.parse(json);

            if (data instanceof Array) {
                let items = [];
                for (let obj of data) {
                    let document = this.collection.fromCompendium(obj, { addFlags: false });
                    items.push(document);
                }
                if (items.length)
                    this.constructor.createDocuments(items);
            } else
                return wrapped(...args);
        }

        if (game.modules.get("lib-wrapper")?.active) {
            libWrapper.register("multiple-document-selection", "Actor.prototype.importFromJSON", importFromJSON, "MIXED");
            libWrapper.register("multiple-document-selection", "Cards.prototype.importFromJSON", importFromJSON, "MIXED");
            libWrapper.register("multiple-document-selection", "Item.prototype.importFromJSON", importFromJSON, "MIXED");
            libWrapper.register("multiple-document-selection", "JournalEntry.prototype.importFromJSON", importFromJSON, "MIXED");
            libWrapper.register("multiple-document-selection", "Playlist.prototype.importFromJSON", importFromJSON, "MIXED");
            libWrapper.register("multiple-document-selection", "Scene.prototype.importFromJSON", importFromJSON, "MIXED");
            libWrapper.register("multiple-document-selection", "RollTable.prototype.importFromJSON", importFromJSON, "MIXED");
            libWrapper.register("multiple-document-selection", "Macro.prototype.importFromJSON", importFromJSON, "MIXED");
        } else {
            for (let entry of [Actor, Cards, Item, JournalEntry, Playlist, Scene, RollTable, Macro]) {
                const oldImportFromJSON = entry.prototype.importFromJSON;
                entry.prototype.importFromJSON = function (event) {
                    return importFromJSON.call(this, oldImportFromJSON.bind(this), ...arguments);
                }
            }
        }

        for (let tabName of ["ActorDirectory", "CardsDirectory", "ItemDirectory", "JournalDirectory", "RollTableDirectory", "MacroDirectory"].concat(additionalDirectories.map(d => d.name))) {
            Hooks.on(`get${tabName}EntryContext`, (html, menuItems, tab) => {
                window.setTimeout(() => {
                    // make sure we're the last one to activate
                    for (let menu of menuItems) {
                        if (!menu.multiple) {
                            let oldCondition = menu.condition;
                            menu.condition = function (li) {
                                if (html.hasClass("multiple-select"))
                                    return false;
                                return typeof oldCondition === "function" ? oldCondition(li) : true;
                            }
                        }
                    }
                }, 500);

                menuItems.push(
                    {
                        icon: '<i class="fas fa-trash"></i>',
                        name: "Delete Multiple",
                        multiple: true,
                        condition: (li) => {
                            return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected');
                        },
                        callback: (li) => {
                            //let tab = Object.values(ui.sidebar.tabs).find(t => t.constructor.name == tabName);
                            MultipleDocumentSelection.deleteDialog(tab);
                        }
                    },
                    {
                        icon: '<i class="far fa-copy"></i>',
                        name: "Duplicate Multiple",
                        multiple: true,
                        condition: (li) => {
                            return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected');
                        },
                        callback: (li) => {
                            //let tab = Object.values(ui.sidebar.tabs).find(t => t.constructor.name == tabName);
                            MultipleDocumentSelection.duplicateDocuments(tab);
                        }
                    },
                    {
                        icon: '<i class="fas fa-lock"></i>',
                        name: "Configure Ownership",
                        multiple: true,
                        condition: (li) => {
                            let entry = [...tab.collection][0];
                            return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected') && entry?.ownership;
                        },
                        callback: (li) => {
                            //let tab = Object.values(ui.sidebar.tabs).find(t => t.constructor.name == tabName);
                            MultipleDocumentSelection.ownershipDialog(tab, li);
                        }
                    },
                    {
                        icon: '<i class="fas fa-file-export"></i>',
                        name: "Export Data",
                        multiple: true,
                        condition: (li) => {
                            return html.hasClass("multiple-select") && li.hasClass('selected') && game.system.id !== "pf2e";
                        },
                        callback: (li) => {
                            //let tab = Object.values(ui.sidebar.tabs).find(t => t.constructor.name == tabName);
                            MultipleDocumentSelection.exportDocuments(tab);
                        }
                    }
                );
            })
        }

        Hooks.on(`getSceneDirectoryEntryContext`, (html, menuItems, tab) => {
            window.setTimeout(() => {
                // make sure we're the last one to activate
                for (let menu of menuItems) {
                    if (!menu.multiple) {
                        let oldCondition = menu.condition;
                        menu.condition = function (li) {
                            if (html.hasClass("multiple-select"))
                                return false;
                            return typeof oldCondition === "function" ? oldCondition(li) : true;
                        }
                    }
                }
            }, 500);

            menuItems.push(
                {
                    icon: '<i class="fas fa-trash"></i>',
                    name: "Delete Multiple",
                    multiple: true,
                    condition: (li) => {
                        return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected');
                    },
                    callback: (li) => {
                        //let tab = Object.values(ui.sidebar.tabs).find(t => t.constructor.name == tabName);
                        MultipleDocumentSelection.deleteDialog(tab);
                    }
                },
                {
                    icon: '<i class="far fa-copy"></i>',
                    name: "Duplicate Multiple",
                    multiple: true,
                    condition: (li) => {
                        return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected');
                    },
                    callback: (li) => {
                        //let tab = Object.values(ui.sidebar.tabs).find(t => t.constructor.name == tabName);
                        MultipleDocumentSelection.duplicateDocuments(tab);
                    }
                },
                {
                    icon: '<i class="fas fa-compass fa-fw"></i>',
                    name: "Toggle Navigation Multiple",
                    multiple: true,
                    condition: (li) => {
                        return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected');
                    },
                    callback: (li) => {
                        //let tab = Object.values(ui.sidebar.tabs).find(t => t.constructor.name == tabName);
                        MultipleDocumentSelection.toggleNavigation(tab);
                    }
                },
                {
                    icon: '<i class="fas fa-lock"></i>',
                    name: "Configure Ownership",
                    multiple: true,
                    condition: (li) => {
                        let entry = [...tab.collection][0];
                        return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected') && entry?.ownership;
                    },
                    callback: (li) => {
                        //let tab = Object.values(ui.sidebar.tabs).find(t => t.constructor.name == tabName);
                        MultipleDocumentSelection.ownershipDialog(tab, li);
                    }
                },
                {
                    icon: '<i class="fas fa-file-export"></i>',
                    name: "Export Data",
                    multiple: true,
                    condition: (li) => {
                        return html.hasClass("multiple-select") && li.hasClass('selected') && game.system.id !== "pf2e";
                    },
                    callback: (li) => {
                        //let tab = Object.values(ui.sidebar.tabs).find(t => t.constructor.name == tabName);
                        MultipleDocumentSelection.exportDocuments(tab);
                    }
                }
            );
        })

        Hooks.on("getCompendiumEntryContext", (html, menuItems) => {
            window.setTimeout(() => {
                // make sure we're the last one to activate
                for (let menu of menuItems) {
                    if (!menu.multiple) {
                        let oldCondition = menu.condition;
                        menu.condition = function (li) {
                            if (html.hasClass("multiple-select"))
                                return false;
                            return typeof oldCondition === "function" ? oldCondition(li) : true;
                        }
                    }
                }
            }, 500);

            menuItems.push(
                {
                    icon: '<i class="fas fa-trash"></i>',
                    name: "Delete Multiple",
                    multiple: true,
                    condition: (li) => {
                        return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected');
                    },
                    callback: (li) => {
                        let compendium = $(li).closest(".Compendium-sidebar");
                        let id = compendium.attr("id");
                        let tab = MultipleDocumentSelection.compendiums.find(c => c.id === id);
                        MultipleDocumentSelection.deleteDialog(tab);
                    }
                }
            );
        })

        Hooks.on(`getPlaylistDirectorySoundContext`, (html, menuItems) => {
            window.setTimeout(() => {
                // make sure we're the last one to activate
                for (let menu of menuItems) {
                    if (!menu.multiple) {
                        let oldCondition = menu.condition;
                        menu.condition = function (li) {
                            if (html.hasClass("multiple-select"))
                                return false;
                            return typeof oldCondition === "function" ? oldCondition(li) : true;
                        }
                    }
                }
            }, 500);

            menuItems.push(
                {
                    icon: '<i class="fas fa-trash"></i>',
                    name: "Delete Multiple",
                    multiple: true,
                    condition: (li) => {
                        return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected');
                    },
                    callback: (li) => {
                        MultipleDocumentSelection.deleteDialog(ui.sidebar.tabs.playlists);
                    }
                },
                {
                    icon: '<i class="fas fa-lock"></i>',
                    name: "Preload Sounds",
                    multiple: true,
                    condition: (li) => {
                        return game.user.isGM && html.hasClass("multiple-select") && li.hasClass('selected');
                    },
                    callback: (li) => {
                        MultipleDocumentSelection.preloadSounds(ui.sidebar.tabs.playlists);
                    }
                }
            );
        });

        patchFunc("ContextMenu.prototype.constructor.create", function (app, html, selector, menuItems, { hookName = "EntryContext", ...options } = {}) {
            for (const cls of app.constructor._getInheritanceChain()) {
                Hooks.call(`get${cls.name}${hookName}`, html, menuItems, app);
            }

            if (menuItems) return new ContextMenu(html, selector, menuItems, options);
        }, "OVERRIDE");
    }

    static selectPlaylistSound(event) {
        const soundId = event.currentTarget.dataset.soundId;
        let tab = ui.sidebar.tabs.playlists;

        if (tab._groupSelect || tab._startPointerDown) {
            if (tab._groupSelect.has(soundId)) {
                //remove the document
                MultipleDocumentSelection.removeDocument(tab, soundId);
            } else {
                //add the document
                if (event.shiftKey && MultipleDocumentSelection._lastId) {
                    let elem1 = $(`.sound[data-sound-id="${soundId}"]`, ui.sidebar.tabs.playlists.element);
                    let elem2 = $(`.sound[data-sound-id="${MultipleDocumentSelection._lastId}"]`, elem1.parent());

                    if (elem2.length) {
                        if (elem2.index() < elem1.index()) {
                            let temp = elem2;
                            elem2 = elem1;
                            elem1 = temp;
                        }
                        let elements = elem1.nextUntil(elem2, 'li');

                        for (let elem of elements) {
                            MultipleDocumentSelection.addDocument(tab, elem.dataset.soundId);
                        }
                    }

                }
                MultipleDocumentSelection.addDocument(tab, soundId);
            }
        }
    }

    static async setup() {
    }

    static async ready() {
        $('body').on("keyup", MultipleDocumentSelection.keyup.bind());
    }

    static onMouseDown(event) {
        let id = (this instanceof PlaylistDirectory ? event.currentTarget.closest(".sound").dataset.soundId : event.currentTarget.closest(".document").dataset.documentId);
        if (!this._groupSelect) {
            let that = this;
            if ($(event.originalEvent.target).hasClass("global-volume-slider"))
                return;

            if (event.ctrlKey) {
                delete this._startPointerDown;
                this._groupSelect = new Set();
                if (this instanceof Compendium) {
                    MultipleDocumentSelection.compendiums.push(this);
                }
                $(this.popOut ? $('.sidebar-tab,.compendium.directory', this.element) : this.element).addClass("multiple-select");
            } else {
                this._startPointerDown = window.setTimeout(() => {
                    if (that._startPointerDown) {
                        // Start thes election process
                        delete that._startPointerDown;
                        that._groupSelect = new Set();
                        if (that instanceof Compendium) {
                            MultipleDocumentSelection.compendiums.push(that);
                        }
                        $(that.popOut ? $('.sidebar-tab,.compendium.directory', that.element) : that.element).addClass("multiple-select");
                        //Add the class, but don't add the document as the click document will handle that, but the user needs a visual queue
                        $(`.document[data-document-id="${id}"],.sound[data-sound-id="${id}"]`, that.element).addClass("selected");
                    }
                }, setting("long-press") * 1000);
            }
        } else {
            // let's fake the item being selected
            $(`.document[data-document-id="${id}"],.sound[data-sound-id="${id}"]`, this.element).addClass("selected");
        }
    }

    static onMouseUp(event) {
        event.preventDefault();
        event.stopPropagation();
        if (this._startPointerDown) {
            window.clearTimeout(this._startPointerDown);
            delete this._startPointerDown;
        }
    }

    static onContext(event) {
        if (this._groupSelect) {
            let id = (this instanceof PlaylistDirectory ? event.currentTarget.closest(".sound").dataset.soundId : event.currentTarget.closest(".document").dataset.documentId);
            if (this._groupSelect.has(id)) {
                // carry on but provide a slightly modified context menu
            } else {
                // cancel the group selection and cancel the context menu
                MultipleDocumentSelection.clearTab(this);
                let closeId = window.setInterval(() => {
                    if (ui.context) {
                        ui.context.menu.hide();
                        ui.context.close();
                        window.clearInterval(closeId);
                    }
                }, 10);
            }
        }
    }

    static addDocument(dir, id) {
        MultipleDocumentSelection._lastId = id;
        dir._groupSelect.add(id);
        $(`.document[data-document-id="${id}"],.sound[data-sound-id="${id}"]`, dir.element).addClass("selected");
    }

    static removeDocument(dir, id) {
        if (MultipleDocumentSelection._lastId == id)
            delete MultipleDocumentSelection._lastId;
        dir._groupSelect.delete(id);
        $(`.document[data-document-id="${id}"],.sound[data-sound-id="${id}"]`, dir.element).removeClass("selected");
        if (dir._groupSelect.size == 0) {
            MultipleDocumentSelection.clearTab(dir);
        }
    }

    static clearTab(dir) {
        if (dir._groupSelect) {
            delete dir._groupSelect;
            delete dir._startPointerDown;
            $('.document.selected,.sound.selected', dir.element).removeClass("selected");
            if (dir.popOut)
                $(".sidebar-tab,.compendium.directory", dir.element).removeClass("multiple-select");
            else
                $(dir.element).removeClass("multiple-select");
        }
        delete MultipleDocumentSelection._lastId;
        if (dir instanceof Compendium) {
            MultipleDocumentSelection.compendiums.findSplice(c => c.id == dir.id);
        }
    }

    static clearAllTabs() {
        for (let dir of MultipleDocumentSelection.compendiums.concat(Object.values(ui.sidebar.tabs))) {
            MultipleDocumentSelection.clearTab(dir);
        }
    }

    static deleteDialog(tab) {
        if (tab) {
            //show the delete dialog for multiple entries
            const documentClass = (tab instanceof PlaylistDirectory ? PlaylistSound : tab.constructor.collection?.documentClass || tab.collection?.documentClass);
            const type = game.i18n.localize(documentClass.metadata.label);
            return Dialog.confirm({
                title: `${game.i18n.format("DOCUMENT.Delete", { type: `${tab._groupSelect.size} ${type}` })}`,
                content: `<h4>${game.i18n.localize("AreYouSure")}</h4><p>${game.i18n.format("MultipleDocumentSelection.DeleteWarning", { count: tab._groupSelect.size })}</p>`,
                yes: async () => {
                    let ids = Array.from(tab._groupSelect).filter(id => {
                        if (tab instanceof PlaylistDirectory)
                            return true;
                        if (tab instanceof Compendium)
                            return !tab.collection.locked;
                        let document = tab.constructor?.collection?.get(id) || tab.collection?.get(id);
                        return document && document.canUserModify(game.user, "delete")
                    });
                    if (ids.length) {
                        if (tab instanceof PlaylistDirectory) {
                            let parents = {};
                            for (let id of ids) {
                                const li = $(`.sound[data-sound-id="${id}"]`, tab.element);
                                const playlistId = li.parents(".playlist").data("document-id");
                                if (!parents[playlistId])
                                    parents[playlistId] = [];
                                parents[playlistId].push(id);
                            }
                            for (let [playlistId, pids] of Object.entries(parents)) {
                                const playlist = game.playlists.get(playlistId);
                                documentClass.deleteDocuments(pids, { parent: playlist });
                            }
                        } else {
                            if (tab instanceof Compendium) {
                                for (let id of ids) {
                                    let document = await tab.collection.getDocument(id);
                                    await document?.delete();
                                }
                            } else {
                                documentClass.deleteDocuments(ids);
                            }
                        }

                        if (ids.length != tab._groupSelect.size) {
                            ui.notifications.warn("Some of these documents weren't deleted because you do not have permissions to complete the request.");
                            for (let id of ids)
                                MultipleDocumentSelection.removeDocument(tab, id);
                        } else
                            MultipleDocumentSelection.clearTab(tab);
                    } else
                        ui.notifications.warn("You do not have permission to delete these documents");
                }
            });
        }
    }

    static duplicateDocuments(tab) {
        if (tab) {
            //show the delete dialog for multiple entries
            const collection = tab.constructor.collection;
            let items = [];
            for (let id of tab._groupSelect) {
                let document = collection.get(id);
                if (document.isOwner) {
                    let data = document.toObject(false);
                    let realname = (data.name.endsWith(" (Copy)") ? data.name.substr(0, data.name.length - 7) : data.name);
                    let name = realname + " (Copy)";
                    let count = 1;
                    while (collection.find(d => d.name == name)) {
                        count++;
                        name = `${realname} (Copy ${count})`;
                    }
                    data.name = name;
                    items.push(data);
                }
            }
            if (items.length) {
                collection.documentClass.createDocuments(items);
                MultipleDocumentSelection.clearTab(tab);
            }
        }
    }

    static async toggleNavigation(tab) {
        if (tab) {
            const collection = tab.constructor.collection;
            let items = [];
            for (let id of tab._groupSelect) {
                let document = collection.get(id);
                if (document.isOwner) {
                    await document.update({ navigation: !document.navigation });
                }
            }
            MultipleDocumentSelection.clearTab(tab);
        }
    }

    static ownershipDialog(tab, li) {
        if (tab) {
            //show the delete dialog for multiple entries
            const collection = tab.constructor.collection;
            const documentClass = collection.documentClass;

            let documents = [];
            for (let id of tab._groupSelect) {
                documents.push(collection.get(id));
            }

            const configClass = WithOwnershipConfig(DocumentOwnershipConfig);
            new configClass({ documents, apps: {}, uuid: "", testUserPermission: () => { return true; }, isOwner: true }, {
                top: Math.min(li[0].offsetTop, window.innerHeight - 350),
                left: window.innerWidth - 720
            }).render(true);
        }
    }

    static exportDocuments(tab) {
        if (tab) {
            const collection = tab.constructor.collection;
            let items = [];
            for (let id of tab._groupSelect) {
                let document = collection.get(id);
                if (document.isOwner) {
                    const data = document.toCompendium(null);
                    data.flags["exportSource"] = {
                        world: game.world.id,
                        system: game.system.id,
                        coreVersion: game.version,
                        systemVersion: game.system.version
                    };
                    items.push(data);
                }
            }
            if (items.length) {
                const filename = `fvtt-${collection.documentName}-multiple.json`;
                saveDataToFile(JSON.stringify(items, null, 2), "text/json", filename);
                if (items.length != tab._groupSelect.size) {
                    ui.notifications.warn("Some of these documents weren't exported because you do not have permissions to complete the request.");
                } else
                    MultipleDocumentSelection.clearTab(tab);
            } else
                ui.notifications.warn("You do not have permission to export these documents");
        }
    }

    static preloadSounds(tab) {
        if (tab) {
            for (let id of tab._groupSelect) {
                //find the actual sounds
                const li = $(`.sound[data-sound-id="${id}"]`, tab.element);
                const playlistId = li.parents(".playlist").data("document-id");
                const playlist = game.playlists.get(playlistId);
                const sound = playlist.sounds.get(id);
                game.audio.preload(sound.path);
            }
            MultipleDocumentSelection.clearTab(tab);
        }
    }

    static keyup(event) {
        if (event.keyCode == 46) {
            let tab = ui.sidebar.tabs[ui.sidebar.activeTab];
            if (tab._groupSelect) {
                event.preventDefault();
                event.stopPropagation();
                MultipleDocumentSelection.deleteDialog(tab);
            }
        }
    }
}

Hooks.once('init', MultipleDocumentSelection.init);
Hooks.once('setup', MultipleDocumentSelection.setup);
Hooks.once('ready', MultipleDocumentSelection.ready);

Hooks.on("renderDocumentDirectory", (directory, html, options) => {
    $((directory instanceof PlaylistDirectory ? '.sound' : '.document'), html)
        .on("pointerdown", MultipleDocumentSelection.onMouseDown.bind(directory))
        .on("pointerup", MultipleDocumentSelection.onMouseUp.bind(directory))
        .on("contextmenu", MultipleDocumentSelection.onContext.bind(directory));

    $('.directory-list', html).on('pointerup', (event) => {
        //ignore if I clicked on a directory
        //if (event.originalEvent.path && event.originalEvent.path.length && $(event.originalEvent.path[0]).hasClass("directory-list"))
            MultipleDocumentSelection.clearTab.call(directory, directory);
    })
});

Hooks.on("renderPlaylistDirectory", (app, html, user) => {
    $('li.sound', html).bindFirst("click", MultipleDocumentSelection.selectPlaylistSound.bind(this));
});

Hooks.on("changeSidebarTab", MultipleDocumentSelection.clearAllTabs);

Hooks.on("renderSceneDirectory", (app, html, options) => {
    $(".document.scene h3.document-name:not(.entry-name)", html).addClass("entry-name");
});

Hooks.on("clickPlaylistSound", (sound) => {
    let directory = ui.sidebar.tabs["playlists"];
    return !(directory._startPointerDown || directory._groupSelect);
});

$.fn.bindFirst = function (name, fn) {
    var elem, handlers, i, _len;
    this.bind(name, fn);
    for (i = 0, _len = this.length; i < _len; i++) {
        elem = this[i];
        handlers = jQuery._data(elem).events[name.split('.')[0]];
        handlers.unshift(handlers.pop());
    }
};
