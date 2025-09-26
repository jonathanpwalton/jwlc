import { Project, Integer } from './syntax.mjs';
import { Instructions } from './ir.mjs';
import * as Types from './types.mjs';
import { Tokens } from './tokens.mjs';
import * as os from 'os';
import { Linux_x86_64 } from './platform/linux_x86_64.mjs';
import { Platform } from './platform/platform.mjs';

/** @type {Platform} */ const platform = {
    'linux x86_64': new Linux_x86_64(),
}[`${os.platform()} ${os.machine()}`];

if (!platform) {
    throw new Error(`unsupported platform: ${os.platform()} ${os.machine()}`);
}

platform.compile(
    new Instructions(new Project(process.argv[2]), platform.getSyscallTypes.bind(platform)),
    process.argv[3]
);
