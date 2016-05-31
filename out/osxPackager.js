"use strict";

const platformPackager_1 = require("./platformPackager");
const metadata_1 = require("./metadata");
const path = require("path");
const bluebird_1 = require("bluebird");
const util_1 = require("./util");
const codeSign_1 = require("./codeSign");
const deepAssign = require("deep-assign");
const electron_osx_sign_tf_1 = require("electron-osx-sign-tf");
//noinspection JSUnusedLocalSymbols
const __awaiter = require("./awaiter");
class OsXPackager extends platformPackager_1.PlatformPackager {
    constructor(info, cleanupTasks) {
        super(info);
        if (this.options.cscLink == null) {
            this.codeSigningInfo = bluebird_1.Promise.resolve(null);
        } else {
            if (this.options.cscKeyPassword == null) {
                throw new Error("cscLink is set, but cscKeyPassword not");
            }
            const keychainName = codeSign_1.generateKeychainName();
            cleanupTasks.push(() => codeSign_1.deleteKeychain(keychainName));
            this.codeSigningInfo = codeSign_1.createKeychain(keychainName, this.options.cscLink, this.options.cscKeyPassword, this.options.cscInstallerLink, this.options.cscInstallerKeyPassword);
        }
    }
    get platform() {
        return metadata_1.Platform.OSX;
    }
    get supportedTargets() {
        return ["dmg", "mas"];
    }
    pack(outDir, arch, postAsyncTasks) {
        return __awaiter(this, void 0, void 0, function* () {
            const packOptions = this.computePackOptions(outDir, this.computeAppOutDir(outDir, arch), arch);
            let nonMasPromise = null;
            if (this.targets.length > 1 || this.targets[0] !== "mas") {
                const appOutDir = this.computeAppOutDir(outDir, arch);
                nonMasPromise = this.doPack(packOptions, outDir, appOutDir, arch, this.customBuildOptions).then(() => this.sign(appOutDir, null)).then(() => {
                    postAsyncTasks.push(this.packageInDistributableFormat(outDir, appOutDir, arch));
                });
            }
            if (this.targets.indexOf("mas") !== -1) {
                // osx-sign - disable warning
                const appOutDir = path.join(outDir, "mas");
                const masBuildOptions = deepAssign({}, this.customBuildOptions, this.devMetadata.build["mas"]);
                yield this.doPack(Object.assign({}, packOptions, { platform: "mas", "osx-sign": false, generateFinalBasename: function () {
                        return "mas";
                    } }), outDir, appOutDir, arch, masBuildOptions);
                yield this.sign(appOutDir, masBuildOptions);
            }
            if (nonMasPromise != null) {
                yield nonMasPromise;
            }
        });
    }
    static findIdentity(certType, name) {
        return __awaiter(this, void 0, void 0, function* () {
            let identity = process.env.CSC_NAME || name;
            if (identity == null || identity.trim().length === 0) {
                return yield codeSign_1.findIdentity(certType);
            } else {
                identity = identity.trim();
                checkPrefix(identity, "Developer ID Application:");
                checkPrefix(identity, "3rd Party Mac Developer Application:");
                checkPrefix(identity, "Developer ID Installer:");
                checkPrefix(identity, "3rd Party Mac Developer Installer:");
                const result = yield codeSign_1.findIdentity(certType, identity);
                if (result == null) {
                    throw new Error(`Identity name "${ identity }" is specified, but no valid identity with this name in the keychain`);
                }
                return result;
            }
        });
    }
    sign(appOutDir, masOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            let codeSigningInfo = yield this.codeSigningInfo;
            if (codeSigningInfo == null) {
                if (process.env.CSC_LINK != null) {
                    throw new Error("codeSigningInfo is null, but CSC_LINK defined");
                }
                const identity = yield OsXPackager.findIdentity(masOptions == null ? "Developer ID Application" : "3rd Party Mac Developer Application", this.customBuildOptions.identity);
                if (identity == null) {
                    const message = "App is not signed: CSC_LINK or CSC_NAME are not specified, and no valid identity in the keychain, see https://github.com/electron-userland/electron-builder/wiki/Code-Signing";
                    if (masOptions == null) {
                        util_1.warn(message);
                        return;
                    } else {
                        throw new Error(message);
                    }
                }
                if (masOptions != null) {
                    const installerName = masOptions == null ? null : yield OsXPackager.findIdentity("3rd Party Mac Developer Installer", this.customBuildOptions.identity);
                    if (installerName == null) {
                        throw new Error("Cannot find valid installer certificate: CSC_LINK or CSC_NAME are not specified, and no valid identity in the keychain, see https://github.com/electron-userland/electron-builder/wiki/Code-Signing");
                    }
                    codeSigningInfo = {
                        name: identity,
                        installerName: installerName
                    };
                } else {
                    codeSigningInfo = {
                        name: identity
                    };
                }
            } else {
                if (codeSigningInfo.name == null && masOptions == null) {
                    throw new Error("codeSigningInfo.name is null, but CSC_LINK defined");
                }
                if (masOptions != null && codeSigningInfo.installerName == null) {
                    throw new Error("Signing is required for mas builds but CSC_INSTALLER_LINK is not specified");
                }
            }
            const identity = codeSigningInfo.name;
            util_1.log(`Signing app (identity: ${ identity })`);
            const baseSignOptions = {
                app: path.join(appOutDir, `${ this.appName }.app`),
                platform: masOptions == null ? "darwin" : "mas",
                keychain: codeSigningInfo.keychainName
            };
            const signOptions = Object.assign({
                identity: identity
            }, this.devMetadata.build["osx-sign"], baseSignOptions);
            const resourceList = yield this.resourceList;
            const customSignOptions = masOptions || this.customBuildOptions;
            if (customSignOptions.entitlements != null) {
                signOptions.entitlements = customSignOptions.entitlements;
            } else {
                const p = `${ masOptions == null ? "osx" : "mas" }.entitlements`;
                if (resourceList.indexOf(p) !== -1) {
                    signOptions.entitlements = path.join(this.buildResourcesDir, p);
                }
            }
            if (customSignOptions.entitlementsInherit != null) {
                signOptions["entitlements-inherit"] = customSignOptions.entitlementsInherit;
            } else {
                const p = `${ masOptions == null ? "osx" : "mas" }.inherit.entitlements`;
                if (resourceList.indexOf(p) !== -1) {
                    signOptions["entitlements-inherit"] = path.join(this.buildResourcesDir, p);
                }
            }
            yield this.doSign(signOptions);
            if (masOptions != null) {
                const pkg = path.join(appOutDir, `${ this.appName }-${ this.metadata.version }.pkg`);
                yield this.doFlat(Object.assign({
                    pkg: pkg,
                    identity: codeSigningInfo.installerName
                }, baseSignOptions));
                this.dispatchArtifactCreated(pkg, `${ this.metadata.name }-${ this.metadata.version }.pkg`);
            }
        });
    }
    doSign(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            return bluebird_1.Promise.promisify(electron_osx_sign_tf_1.sign)(opts);
        });
    }
    doFlat(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            return bluebird_1.Promise.promisify(electron_osx_sign_tf_1.flat)(opts);
        });
    }
    computeEffectiveDistOptions(appOutDir) {
        return __awaiter(this, void 0, void 0, function* () {
            const specification = deepAssign({
                title: this.appName,
                "icon-size": 80,
                contents: [{
                    "x": 410, "y": 220, "type": "link", "path": "/Applications"
                }, {
                    "x": 130, "y": 220, "type": "file"
                }],
                format: this.devMetadata.build.compression === "store" ? "UDRO" : "UDBZ"
            }, this.customBuildOptions);
            if (!("icon" in this.customBuildOptions)) {
                const resourceList = yield this.resourceList;
                if (resourceList.indexOf("icon.icns") !== -1) {
                    specification.icon = path.join(this.buildResourcesDir, "icon.icns");
                } else {
                    util_1.warn("Application icon is not set, default Electron icon will be used");
                }
            }
            if (!("background" in this.customBuildOptions)) {
                const resourceList = yield this.resourceList;
                if (resourceList.indexOf("background.png") !== -1) {
                    specification.background = path.join(this.buildResourcesDir, "background.png");
                }
            }
            specification.contents[1].path = path.join(appOutDir, this.appName + ".app");
            return specification;
        });
    }
    packageInDistributableFormat(outDir, appOutDir, arch) {
        const promises = [];
        for (let target of this.targets) {
            if (target === "dmg" || target === "default") {
                promises.push(this.createDmg(appOutDir));
            }
            if (target !== "mas" && target !== "dmg") {
                const format = target === "default" ? "zip" : target;
                util_1.log(`Creating OS X ${ format }`);
                // for default we use mac to be compatible with Squirrel.Mac
                const classifier = target === "default" ? "mac" : "osx";
                // we use app name here - see https://github.com/electron-userland/electron-builder/pull/204
                const outFile = path.join(appOutDir, `${ this.appName }-${ this.metadata.version }-${ classifier }.${ format }`);
                promises.push(this.archiveApp(format, appOutDir, outFile).then(() => this.dispatchArtifactCreated(outFile, `${ this.metadata.name }-${ this.metadata.version }-${ classifier }.${ format }`)));
            }
        }
        return bluebird_1.Promise.all(promises);
    }
    createDmg(appOutDir) {
        return __awaiter(this, void 0, void 0, function* () {
            const artifactPath = path.join(appOutDir, `${ this.appName }-${ this.metadata.version }.dmg`);
            yield new bluebird_1.Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                util_1.log("Creating DMG");
                const dmgOptions = {
                    target: artifactPath,
                    basepath: this.projectDir,
                    specification: yield this.computeEffectiveDistOptions(appOutDir)
                };
                if (util_1.debug.enabled) {
                    util_1.debug(`appdmg: ${ JSON.stringify(dmgOptions, null, 2) }`);
                }
                const emitter = require("appdmg")(dmgOptions);
                emitter.on("error", reject);
                emitter.on("finish", () => resolve());
                if (util_1.debug.enabled) {
                    emitter.on("progress", info => {
                        if (info.type === "step-begin") {
                            util_1.debug(`appdmg: [${ info.current }] ${ info.title }`);
                        }
                    });
                }
            }));
            this.dispatchArtifactCreated(artifactPath, `${ this.metadata.name }-${ this.metadata.version }.dmg`);
        });
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = OsXPackager;
function checkPrefix(name, prefix) {
    if (name.startsWith(prefix)) {
        throw new Error(`Please remove prefix "${ prefix }" from the specified name — appropriate certificate will be chosen automatically`);
    }
}
//# sourceMappingURL=osxPackager.js.map