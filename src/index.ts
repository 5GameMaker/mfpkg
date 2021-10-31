#!/usr/bin/env node

import { createInterface } from 'readline';
import { getMod, getMods } from 'mc-curseforge-api';
import { join } from 'path';
import { existsSync as exists, readdirSync as readdir } from 'fs';
import { mkdir, rm } from 'fs/promises';
import download from 'download';

function stoi(s : string) : number {
    // @ts-ignore
    return s - 0;
}

function validate(s : string, o : string) : boolean {
    return o
        .toLowerCase()
        .split(/ +/g)
        .every(
            a => s
                .toLowerCase()
                .replace(/\(.+\)/g, '')
                .includes(a)
        );
}

function getValidName(name: string): string {
    return name.toLowerCase().replace(/\(.+\)/g, '').replace(/[^a-z0-9\._]/g, '-').replace(/\-+/g, '-');
}

async function main() {
    const modsFolder = join(process.cwd(), process.cwd().match(/[\/\\]mods[\/\\]?$/) ? '' : 'mods');

    if (!exists(modsFolder)) {
        await mkdir(modsFolder);
    }

    switch (process.argv[2]) {
        case 'list':
        {
            const dir = readdir(modsFolder);
            if (dir.length) {
                dir.map(a => console.log(a));
            }
            else console.log(`This server has no mods installed`);
        }
        break;

        case 'search':
        {
            const version = process.argv[3];
            const query = process.argv.slice(4).join(' ').trim();
            
            if (query.length == 0 || !["1.17.1", "1.16.5"].includes(version)) {
                console.log(`Usage: ${process.argv0} list <version> <query>`);
                process.exit(1);
            }
            
            let mods = await getMods({
                gameVersion: version,
                searchFilter: query,
            });
            
            if (mods instanceof Error) {
                console.error(mods);
                process.exit(1);
            }

            mods = mods
                .filter(a => validate(a.name, query));
            
            if (!mods.length) return console.log(`No mods found`);
            
            console.log(`Mod list for ${version} (${query.replace(/[()]/g, s => `\\${s}`)})`);
            mods.map(mod => console.log(`${mod.name} (${mod.id})`));
        }
        break;

        case 'download':
        {
            const version = process.argv[3];
            const query = process.argv.slice(4).join(' ').trim();
            const installedMods : number[] = [];
            
            if (query.length == 0 || !["1.17.1", "1.16.5"].includes(version)) {
                console.log(`Usage: ${process.argv0} download <version> <query>`);
                process.exit(1);
            }
            
            let mods = await getMods({
                gameVersion: version,
                searchFilter: query,
            });
            
            if (mods instanceof Error) {
                console.error(mods);
                process.exit(1);
            }

            mods = mods
                .filter(a => validate(a.name, query));
            
            if (!mods.length) return console.log(`No mods found`);
            
            mods.map((mod, i) => console.log(`${i}) ${mod.name} (${mod.id})`));

            const rl = createInterface(
                process.stdin,
                process.stdout
            );
            const prompt = () => new Promise<string>(res => rl.question('> ', res));

            const modID = stoi(await prompt());
            if (isNaN(modID) || modID < 0 || modID >= mods.length) {
                console.log(`Exiting...`);
                return;
            }

            const mod = mods[modID];

            const install = async (mod : Mod) => {
                installedMods.push(mod.id);

                console.log(`Installing ${mod.name} (${mod.id})...`);

                const files = (await mod.getFiles())
                    .filter(a => a.minecraft_versions.includes(version))
                    .filter(a => a.minecraft_versions.includes("Fabric"))
                    .filter(a => a.available)
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                if (!files.length) {
                    console.log(`Failed to download ${mod.name}: no version available`);
                    return;
                }

                files.map((a, i) => console.log(`${i}) ${
                    a.file_name ||
                    ((a.download_url.match(/(?:\/)(?<filename>(.(?!\/))+)\/?$/) || { groups : {} })
                        .groups || {}).filename ||
                    mod.name
                } [${a.minecraft_versions.join(', ')}]`));
                const fileID = stoi(await prompt());

                if (isNaN(fileID) || fileID < 0 || fileID >= files.length) {
                    console.log(`Skipped`);
                    return;
                }

                const file = files[fileID];

                const fileName = getValidName(file.file_name || `${mod.name}-${file.minecraft_versions[0]}.jar`);

                console.log(`Downloading ${fileName} (${file.file_size})...`);

                if (exists(join(modsFolder, fileName))) {
                    await rm(join(modsFolder, fileName), {
                        force: true,
                        recursive: true,
                    });
                }

                await download(
                    file.download_url,
                    modsFolder,
                    {
                        filename: fileName,
                    }
                );

                console.log(`File downloaded: ${join(modsFolder, fileName)}`);

                const deps = (await file.getDependencies())
                    .filter(a => !installedMods.includes(a.id));

                if (!deps.length) return;

                console.log(`Installing dependencies: ${deps.map(a => a.name).join(', ')}`);

                for (const dep of deps) {
                    if (installedMods.includes(dep.id)) {
                        console.log(`Dependency already satisfied: ${dep.name}`);
                        continue;
                    }

                    await install(dep);
                }
            }

            await install(mod);

            rl.close();
        }
        break;
            
        case 'install':
        {
            const version = process.argv[3];
            const mods = process.argv.slice(4);
            const installedMods : number[] = [];

            if (!mods.length || !["1.17.1", "1.16.5"].includes(version)) {
                console.log(`Usage: ${process.argv0} install <version> <...ids or names>`);
                process.exit(1);
            }
            
            const install = async (mod : Mod) => {
                installedMods.push(mod.id);

                console.log(`Installing ${mod.name} (${mod.id})...`);

                const file = (await mod.getFiles())
                    .filter(a => a.minecraft_versions.includes(version))
                    .filter(a => a.minecraft_versions.includes("Fabric"))
                    .filter(a => a.available)
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                    .shift();

                if (!file) {
                    console.log(`Failed to download ${mod.name}: no version available`);
                    return;
                }

                const fileName = getValidName(file.file_name || `${mod.name}-${file.minecraft_versions[0]}.jar`);

                console.log(`Downloading ${fileName} (${file.file_size})...`);

                if (exists(join(modsFolder, fileName))) {
                    console.log(`File exists: ${join(modsFolder, fileName)}`);
                    return;
                }

                await download(
                    file.download_url,
                    modsFolder,
                    {
                        filename: fileName,
                    }
                );

                console.log(`File downloaded: ${join(modsFolder, fileName)}`);

                const deps = (await file.getDependencies())
                    .filter(a => !installedMods.includes(a.id));

                if (!deps.length) return;

                console.log(`Installing dependencies: ${deps.map(a => a.name).join(', ')}`);

                for (const dep of deps) {
                    if (installedMods.includes(dep.id)) {
                        console.log(`Dependency already satisfied: ${dep.name}`);
                        continue;
                    }

                    await install(dep);
                }
            }
            
            for (const mod of mods) {
                if (!isNaN(stoi(mod))) {
                    try {
                        await install(await getMod(stoi(mod)));
                    } catch (err) {
                        console.log(`Failed to install mod ${mod}: ${(err as Error).stack || err}`);
                    }
                }
                else {
                    let mods = await getMods({
                        gameVersion: version,
                        searchFilter: mod,
                    });
                    
                    if (mods instanceof Error) {
                        console.log(`Usage: ${process.argv0} install <version> <...ids or names>`);
                        process.exit(1);
                    }

                    mods = mods
                        .filter(a => validate(a.name, mod));
                    
                    if (!mods.length) {
                        console.log(`Cannot find mod ${mod}`);
                        continue;
                    }
                    
                    try {
                        await install(mods[0]);
                    } catch (err) {
                        console.log(`Failed to install mod ${mod}: ${(err as Error).stack || err}`);
                    }
                }
            }
        }
        break;

        default:
            console.log(`Usage: ${process.argv0} ...`);
            console.log(`\tlist - list all installed mods`);
            console.log(`\tsearch <version> <query> - search for mod`);
            console.log(`\tdownload <version> <query> - download a singular mod (in case something went wrong)`);
            console.log(`\tinstall <version> <...mods or mod ids> - list all installed mods`);
        break;
    }
}
if (require.main === module) main();
