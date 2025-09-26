import { Instructions } from '../ir.mjs';
import { Type } from '../types.mjs';

export class Platform {
    /**
     * @param {Instructions} instructions 
     * @param {string} outputPath 
     */
    compile(instructions, outputPath) {
        throw new Error(`unimplemented: ${this.constructor.name}.compile()`);
    }

    /**
     * @param {number} number 
     * @returns {[Type[], Type]}
     */
    getSyscallTypes(number) {
        throw new Error(`unimplemented: ${this.constructor.name}.getSyscallTypes()`);
    }
}
