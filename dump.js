Module.ensureInitialized('Foundation');

const O_RDONLY = 0;
const O_WRONLY = 1;
const O_RDWR = 2;
const O_CREAT = 512;

const SEEK_SET = 0;
const SEEK_CUR = 1;
const SEEK_END = 2;

function ptrAddr(addr) {
    return typeof (addr) == 'number' ? ptr(addr) : addr;
}

function allocStr(str) {
    return Memory.allocUtf8String(str);
}

function putStr(addr, str) {
    return Memory.writeUtf8String(ptrAddr(addr), str);
}

function getByteArr(addr, l) {
    return Memory.readByteArray(ptrAddr(addr), l);
}

function getU8(addr) {
    return Memory.readU8(ptrAddr(addr));
}

function putU8(addr, n) {
    return Memory.writeU8(ptrAddr(addr), n);
}

function getU16(addr) {
    return Memory.readU16(ptrAddr(addr));
}

function putU16(addr, n) {
    return Memory.writeU16(ptrAddr(addr), n);
}

function getU32(addr) {
    return Memory.readU32(ptrAddr(addr));
}

function putU32(addr, n) {
    return Memory.writeU32(ptrAddr(addr), n);
}

function getU64(addr) {
    return Memory.readU64(ptrAddr(addr));
}

function putU64(addr, n) {
    return Memory.writeU64(ptrAddr(addr), n);
}

function getPt(addr) {
    return Memory.readPointer(ptrAddr(addr));
}

function putPt(addr, n) {
    return Memory.writePointer(ptrAddr(addr), ptrAddr(n));
}

function malloc(size) {
    return Memory.alloc(size);
}

function getExportFunction(type, name, ret, args) {
    let nptr;
    nptr = Module.findExportByName(null, name);
    if (nptr === null) {
        console.log("cannot find " + name);
        return null;
    } else {
        if (type === "f") {
            let funclet = new NativeFunction(nptr, ret, args);
            if (typeof funclet === "undefined") {
                console.log("parse error " + name);
                return null;
            }
            return funclet;
        } else if (type === "d") {
            let datalet = Memory.readPointer(nptr);
            if (typeof datalet === "undefined") {
                console.log("parse error " + name);
                return null;
            }
            return datalet;
        }
    }
}

let NSSearchPathForDirectoriesInDomains = getExportFunction("f", "NSSearchPathForDirectoriesInDomains", "pointer", ["int", "int", "int"]);
let wrapper_open = getExportFunction("f", "open", "int", ["pointer", "int", "int"]);
let read = getExportFunction("f", "read", "int", ["int", "pointer", "int"]);
let write = getExportFunction("f", "write", "int", ["int", "pointer", "int"]);
let lseek = getExportFunction("f", "lseek", "int64", ["int", "int64", "int"]);
let close = getExportFunction("f", "close", "int", ["int"]);
let remove = getExportFunction("f", "remove", "int", ["pointer"]);
let access = getExportFunction("f", "access", "int", ["pointer", "int"]);
let dlopen = getExportFunction("f", "dlopen", "pointer", ["pointer", "int"]);

function getDocumentDir() {
    let NSDocumentDirectory = 9;
    let NSUserDomainMask = 1;
    let npdirs = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, 1);
    return ObjC.Object(npdirs).objectAtIndex_(0).toString();
}

function open(pathname, flags, mode) {
    if (typeof pathname == "string") {
        pathname = allocStr(pathname);
    }
    return wrapper_open(pathname, flags, mode);
}

let modules = null;

function getAllAppModules() {
    if (modules == null) {
        modules = new Array();
        let tmpmods = Process.enumerateModulesSync();
        for (let i = 0; i < tmpmods.length; i++) {
            if (tmpmods[i].path.lastIndexOf(".app") != -1) {
                modules.push(tmpmods[i]);
            }
        }
    }
    return modules;
}

const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;
const MH_MAGIC = 0xfeedface;
const MH_CIGAM = 0xcefaedfe;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const LC_SEGMENT = 0x1;
const LC_SEGMENT_64 = 0x19;
const LC_ENCRYPTION_INFO = 0x21;
const LC_ENCRYPTION_INFO_64 = 0x2C;

function pad(str, n) {
    return Array(n - str.length + 1).join("0") + str;
}

function swap32(value) {
    value = pad(value.toString(16), 8)
    let rs = "";
    for (let i = 0; i < value.length; i = i + 2) {
        rs += value.charAt(value.length - i - 2);
        rs += value.charAt(value.length - i - 1);
    }
    return parseInt(rs, 16)
}

function dumpModule(name) {
    const modules = getAllAppModules();

    let targetmod = null;
    let i = 0;
    for (; i < modules.length; i++) {
        if (modules[i].path.indexOf(name) != -1) {
            targetmod = modules[i];
            break;
        }
    }
    if (targetmod == null) {
        console.log("Cannot find module");
        return;
    }
    let modbase = modules[i].base;
    let modsize = modules[i].size;
    let newmodname = modules[i].name;
    let newmodpath = getDocumentDir() + "/" + newmodname + ".fid";
    let oldmodpath = modules[i].path;


    if (!access(allocStr(newmodpath), 0)) {
        remove(allocStr(newmodpath));
    }

    let fmodule = open(newmodpath, O_CREAT | O_RDWR, 0);
    let foldmodule = open(oldmodpath, O_RDONLY, 0);

    if (fmodule == -1 || foldmodule == -1) {
        console.log("Cannot open file" + newmodpath);
        return;
    }

    let is64bit = false;
    let size_of_mach_header = 0;
    let magic = getU32(modbase);
    let cur_cpu_type = getU32(modbase.add(4));
    let cur_cpu_subtype = getU32(modbase.add(8));
    if (magic == MH_MAGIC || magic == MH_CIGAM) {
        is64bit = false;
        size_of_mach_header = 28;
    } else if (magic == MH_MAGIC_64 || magic == MH_CIGAM_64) {
        is64bit = true;
        size_of_mach_header = 32;
    }

    const BUFSIZE = 4096;
    let buffer = malloc(BUFSIZE);

    read(foldmodule, buffer, BUFSIZE);

    let fileoffset = 0;
    let filesize = 0;
    magic = getU32(buffer);
    if (magic == FAT_CIGAM || magic == FAT_MAGIC) {
        let off = 4;
        let archs = swap32(getU32(buffer.add(off)));
        for (i = 0; i < archs; i++) {
            let cputype = swap32(getU32(buffer.add(off + 4)));
            let cpusubtype = swap32(getU32(buffer.add(off + 8)));
            if (cur_cpu_type == cputype && cur_cpu_subtype == cpusubtype) {
                fileoffset = swap32(getU32(buffer.add(off + 12)));
                filesize = swap32(getU32(buffer.add(off + 16)));
                break;
            }
            off += 20;
        }

        if (fileoffset == 0 || filesize == 0)
            return;

        lseek(fmodule, 0, SEEK_SET);
        lseek(foldmodule, fileoffset, SEEK_SET);
        for (i = 0; i < parseInt(filesize / BUFSIZE); i++) {
            read(foldmodule, buffer, BUFSIZE);
            write(fmodule, buffer, BUFSIZE);
        }
        if (filesize % BUFSIZE) {
            read(foldmodule, buffer, filesize % BUFSIZE);
            write(fmodule, buffer, filesize % BUFSIZE);
        }
    } else {
        let readLen = 0;
        lseek(foldmodule, 0, SEEK_SET);
        lseek(fmodule, 0, SEEK_SET);
        while (readLen = read(foldmodule, buffer, BUFSIZE)) {
            write(fmodule, buffer, readLen);
        }
    }

    let ncmds = getU32(modbase.add(16));
    let off = size_of_mach_header;
    let offset_cryptid = -1;
    let crypt_off = 0;
    let crypt_size = 0;
    let segments = [];
    for (i = 0; i < ncmds; i++) {
        let cmd = getU32(modbase.add(off));
        let cmdsize = getU32(modbase.add(off + 4));
        if (cmd == LC_ENCRYPTION_INFO || cmd == LC_ENCRYPTION_INFO_64) {
            offset_cryptid = off + 16;
            crypt_off = getU32(modbase.add(off + 8));
            crypt_size = getU32(modbase.add(off + 12));
        }
        off += cmdsize;
    }

    if (offset_cryptid != -1) {
        let tpbuf = malloc(8);
        putU64(tpbuf, 0);
        lseek(fmodule, offset_cryptid, SEEK_SET);
        write(fmodule, tpbuf, 4);
        lseek(fmodule, crypt_off, SEEK_SET);
        write(fmodule, modbase.add(crypt_off), crypt_size);
    }

    close(fmodule);
    close(foldmodule);
    return newmodpath
}

function loadAllDynamicLibrary(app_path) {
    const defaultManager = ObjC.classes.NSFileManager.defaultManager();
    let errorPtr = Memory.alloc(Process.pointerSize);
    Memory.writePointer(errorPtr, NULL);
    let filenames = defaultManager.contentsOfDirectoryAtPath_error_(app_path, errorPtr);
    for (let i = 0; i < filenames.count(); i++) {
        let file_name = filenames.objectAtIndex_(i);
        let file_path = app_path.stringByAppendingPathComponent_(file_name);
        if (file_name.hasSuffix_(".framework")) {
            let bundle = ObjC.classes.NSBundle.bundleWithPath_(file_path);
            if (bundle.isLoaded()) {
                console.log("[frida-ios-dump]: " + file_name + " has been loaded. ");
            } else {
                if (bundle.load()) {
                    console.log("[frida-ios-dump]: Load " + file_name + " success. ");
                } else {
                    console.log("[frida-ios-dump]: Load " + file_name + " failed. ");
                }
            }
        } else if (file_name.hasSuffix_(".bundle") ||
            file_name.hasSuffix_(".momd") ||
            file_name.hasSuffix_(".strings") ||
            file_name.hasSuffix_(".appex") ||
            file_name.hasSuffix_(".app") ||
            file_name.hasSuffix_(".lproj") ||
            file_name.hasSuffix_(".storyboardc")) {
            continue;
        } else {
            let isDirPtr = Memory.alloc(Process.pointerSize);
            Memory.writePointer(isDirPtr, NULL);
            defaultManager.fileExistsAtPath_isDirectory_(file_path, isDirPtr);
            if (Memory.readPointer(isDirPtr) == 1) {
                loadAllDynamicLibrary(file_path);
            } else {
                if (file_name.hasSuffix_(".dylib")) {
                    let is_loaded = 0;
                    for (let module of modules) {
                        if (module.path.indexOf(file_name) != -1) {
                            is_loaded = 1;
                            console.log("[frida-ios-dump]: " + file_name + " has been dlopen.");
                            break;
                        }
                    }
                    if (!is_loaded) {
                        if (dlopen(allocStr(file_path.UTF8String()), 9)) {
                            console.log("[frida-ios-dump]: dlopen " + file_name + " success. ");
                        } else {
                            console.log("[frida-ios-dump]: dlopen " + file_name + " failed. ");
                        }
                    }
                }
            }
        }
    }
}

function handleMessage(message) {
    const modules = getAllAppModules();
    let appPath = ObjC.classes.NSBundle.mainBundle().bundlePath();
    loadAllDynamicLibrary(appPath);
    // start dump
    for (const module of modules) {
        console.log("start dump " + module.path);
        send({
            dump: dumpModule(module.path),
            path: module.path
        });
    }
    send({
        app: appPath.toString()
    });
    send({
        done: "ok"
    });
    recv(handleMessage);
}

recv(handleMessage);