import { BeginAggregate, Call, CmpEq, CmpLe, CmpLt, Epilogue, JumpIfFalse, Label, OffsetReferenceToMember, Pop, Prologue, PushDifference, PushFunctionAddress, PushInteger, PushLocalReference, PushProduct, PushQuotient, PushReturnValue, PushScalar, PushSum, PushSyscallReturnValue, PushTopReference, ReadValue, ReserveParameter, Return, Rotate, Shutdown, Startup, StoreMember, Syscall } from '../ir.mjs';
import * as Types from '../types.mjs';
import { Platform } from './platform.mjs';
import { tmpdir } from 'os';
import { execSync as run } from 'child_process';
import * as fs from 'fs';
import assert from 'assert';

const rax = {8: 'rax', 4: 'eax',  2: 'ax',   1: 'al'};
const rbx = {8: 'rbx', 4: 'ebx',  2: 'bx',   1: 'bl'};
const rcx = {8: 'rcx', 4: 'ecx',  2: 'cx',   1: 'cl'};
const rdx = {8: 'rdx', 4: 'edx',  2: 'dx',   1: 'dl'};
const rsi = {8: 'rsi', 4: 'esi',  2: 'si',   1: 'sil'};
const rdi = {8: 'rdi', 4: 'edi',  2: 'di',   1: 'dil'};
const rbp = {8: 'rbp', 4: 'ebp',  2: 'bp',   1: 'bpl'};
const rsp = {8: 'rsp', 4: 'esp',  2: 'sp',   1: 'spl'};
const r8  = {8: 'r8',  4: 'r8d',  2: 'r8w',  1: 'r8b'};
const r9  = {8: 'r9',  4: 'r9d',  2: 'r9w',  1: 'r9b'};
const r10 = {8: 'r10', 4: 'r10d', 2: 'r10w', 1: 'r10b'};
const r11 = {8: 'r11', 4: 'r11d', 2: 'r11w', 1: 'r11b'};
const r12 = {8: 'r12', 4: 'r12d', 2: 'r12w', 1: 'r12b'};
const r13 = {8: 'r13', 4: 'r13d', 2: 'r13w', 1: 'r13b'};
const r14 = {8: 'r14', 4: 'r14d', 2: 'r14w', 1: 'r14b'};
const r15 = {8: 'r15', 4: 'r15d', 2: 'r15w', 1: 'r15b'};

export class Linux_x86_64 extends Platform {
    getSyscallTypes(number) { switch (number) {
        case 60:
            return [[Types.u64, Types.s32], Types.never];
        default:
            throw new Error(`unimplemented: syscall #${number}`);
    }}

    compile(instructions, outputPath) {
        const asm = [];
        const mods = [];
        let stack = new Stack();

        let indent = 0;
        const ogpush = asm.push.bind(asm);
        asm.push = function (...lines) {
            return ogpush(...lines.map(l =>
                l.startsWith('#') || l.endsWith(':')
                    ? l
                    : `${' '.repeat(indent)}${l}`
            ));
        };

        for (const op of instructions) {
            if (op instanceof Startup) {
                asm.push(
                    `default rel`,
                    `global _start`,
                    `_start:`,
                    `#CALLMODS#`,
                );
            } else if (op instanceof Shutdown) {
                asm.push(
                    `mov rax, 60`,
                    `mov rdi, 0`,
                    `syscall`,
                );
            } else if (op instanceof Prologue) {
                if (typeof op.index === 'string' && op.index.startsWith('module')) {
                    mods.push(`call f${op.index}`);
                }

                stack = new Stack();
                indent += 2;
                asm.push(
                    `f${op.index}:`,
                    `push r9`,
                    `mov r9, rsi`,
                    `push r10`,
                    `mov r10, rdi`,
                    `push rbp`,
                    `mov rbp, rsp`,
                    `#SUBRSP#`,
                );
            } else if (op instanceof Epilogue) {
                while (stack.maxOffset % 16 != 0) stack.maxOffset++;
                if (asm[asm.length - 1] === 'jmp .epilogue')
                    asm.pop();
                asm[asm.indexOf('#SUBRSP#')] = `  sub rsp, ${stack.maxOffset}`;
                asm.push(
                    `.epilogue:`,
                    `mov rsp, rbp`,
                    `pop rbp`,
                    `mov rdi, r10`,
                    `pop r10`,
                    `mov rsi, r9`,
                    `pop r9`,
                    `ret`
                );
                indent -= 2;
            } else if (op instanceof PushFunctionAddress) {
                asm.push(
                    `lea rax, f${op.index}`,
                    `mov ${stack.push(op.type)}, rax`,
                );
            } else if (op instanceof Call) {
                let entry = (() => {
                    let entries = []
                    for (let i = 0; i < op.argc; i++)
                        entries.push(stack.pop());
                    return entries[entries.length - 1];
                })();
                if (entry) {
                    asm.push(`lea rdi, ${entry}`);
                }
                const fn = stack.pop();
                
                const oldOffset = stack.offset;
                const align = getTypeAlignment(op.type.output);
                if (align) {
                    while (stack.offset % align != 0) stack.offset++;
                }

                asm.push(
                    `lea rsi, [rsp + ${stack.offset}]`,
                    `call ${fn}`
                );
                stack.offset = oldOffset;
            } else if (op instanceof PushReturnValue) {
                stack.push(op.type);
            } else if (op instanceof Pop) {
                stack.pop();
            } else if (op instanceof ReserveParameter) {
                stack.parameter(op.type);
            } else if (op instanceof PushInteger) {
                const reg = rax[op.type.length / 8];
                asm.push(
                    `mov ${reg}, ${op.value}`,
                    `mov ${stack.push(op.type)}, ${reg}`,
                );
            } else if (op instanceof PushLocalReference) {
                asm.push(
                    `lea rax, ${stack.at(op.index)}`,
                    `mov ${stack.refer(op.index)}, rax`
                );
            } else if (op instanceof PushTopReference) {
                asm.push(
                    `lea rax, ${stack.top()}`,
                    `mov ${stack.refer(-1)}, rax`
                );
            } else if (op instanceof ReadValue) {
                const entry = stack.pop();
                asm.push(
                    `mov rbx, ${entry}`,
                    ...copyToMemory(
                        stack.push(entry.type.pointee),
                        '[rbx]',
                        getTypeSize(entry.type.pointee)
                    )
                );
            } else if (op instanceof Syscall) {
                const regs = [rax, rdi, rsi, rdx, r10, r8, r9];
                for (let i = op.argc - 1; i >= 0; i--) {
                    const entry = stack.pop();
                    asm.push(`mov ${regs[i][entry.size]}, ${entry}`);
                }
                asm.push(`syscall`);
            } else if (op instanceof PushSyscallReturnValue) {
                const entry = stack.push(op.type);
                if (entry) {
                    asm.push(
                        `mov ${entry}, ${rax[entry.size]}`
                    );
                }
            } else if ((
                op instanceof CmpLt || 
                op instanceof CmpLe ||
                op instanceof CmpEq
            ) && op.type.integral) {
                const rhs = rbx[op.type.length / 8];
                const lhs = rax[op.type.length / 8];
                const ins = op instanceof CmpLt ? 'cmovl' :
                    op instanceof CmpLe ? 'cmovle' :
                    op instanceof CmpEq ? 'cmove' :
                    (() => { throw new Error(op) })();
                
                asm.push(
                    `mov rdx, 1`,
                    `xor rcx, rcx`,
                    `mov ${rhs}, ${stack.pop()}`,
                    `mov ${lhs}, ${stack.pop()}`,
                    `cmp ${lhs}, ${rhs}`,
                    `${ins} rcx, rdx`,
                    `mov ${stack.push(Types.bool)}, cl`,
                );
            } else if ((
                op instanceof PushSum ||
                op instanceof PushDifference ||
                op instanceof PushProduct ||
                op instanceof PushQuotient
            ) && op.type.integral) {
                const rhs = rbx[op.type.length / 8];
                const lhs = rax[op.type.length / 8];
                const ins = op instanceof PushSum ? 'add' :
                    op instanceof PushDifference ? 'sub' :
                    op instanceof PushProduct ? 'imul' :
                    op.type.signed ? 'idiv' : 'div';

                asm.push(
                    `mov ${rhs}, ${stack.pop()}`,
                    `mov ${lhs}, ${stack.pop()}`,
                    ['imul', 'idiv', 'div'].includes(ins) ?
                        `${ins} ${rhs}` :
                        `${ins} ${lhs}, ${rhs}`,
                    `mov ${stack.push(op.type)}, ${lhs}`,
                );
            } else if (op instanceof Return) {
                const entry = stack.pop();
                asm.push(
                    ...copyToMemory('[r9]', entry, entry.size),
                    `jmp .epilogue`,
                );
            } else if (op instanceof PushScalar) {
                const val = op.type.length == 32 ?
                    new Uint32Array(new Float32Array([op.value]).buffer)[0] :
                    new BigUint64Array(new Float64Array([op.value]).buffer)[0];
                asm.push(
                    `mov ${rax[op.type.length / 8]}, 0x${val.toString(16)}`,
                    `mov ${stack.push(op.type)}, ${rax[op.type.length / 8]}`
                );
            } else if (op instanceof BeginAggregate) {
                stack.push(op.type);
            } else if (op instanceof OffsetReferenceToMember) {
                assert(stack.top().reference !== undefined);
                const obj = stack.at(stack.top().reference).members[op.index];
                asm.push(
                    `mov rax, ${stack.pop()}`,
                    `add rax, ${obj.offset}`,
                    `mov ${stack.push(Types.ptr(obj.type))}, rax`
                );
            } else if (op instanceof Rotate) {
                const a = stack.at(-2);
                const b = stack.at(-1);
                const tmpa = stack.push(a.type);
                asm.push(
                    ...copyToMemory(tmpa, a, a.size),
                    ...copyToMemory(a, b, b.size),
                );
                stack.pop();
                stack.pop();
                stack.pop();
                stack.push(b.type);
                const newa = stack.push(a.type);
                asm.push(
                    ...copyToMemory(newa, tmpa, a.size)
                );
            } else if (op instanceof StoreMember) {
                const member = stack.pop();
                const aggregate = stack.top();
                asm.push(
                    ...copyToMemory(aggregate.members[op.index], member, member.size)
                );
            } else if (op instanceof JumpIfFalse) {
                asm.push(
                    `mov al, 1`,
                    `mov bl, ${stack.pop()}`,
                    `cmp al, bl`,
                    `jne .l${op.index}`,
                )
            } else if (op instanceof Label) {
                asm.push(`.l${op.index}:`);
            } else {
                console.log(asm.join('\n'));
                console.dir(op, {depth: null});
                throw new Error(`unimplemented: ${op.constructor.name}`);
            }
        }

        asm[asm.indexOf('#CALLMODS#')] = mods.join('\n');

        const asmPath = `${tmpdir()}/jwl.s`;
        const objPath = `${tmpdir()}/jwl.o`;

        fs.writeFileSync(asmPath, asm.join('\n'));
        run(`nasm -f elf64 -o ${objPath} ${asmPath}`);
        run(`ld -o ${outputPath} ${objPath}`);
    }
}

class Entry {
    /**
     * @param {Types.Type} type 
     * @param {number} offset 
     * @param {number} size 
     * @param {number} alignment 
     */
    constructor(type, offset, size, alignment, name = null) {
        this.type = type;
        this.offset = offset;
        this.size = size;
        this.alignment = alignment;
        this.name = name ? name : `[rsp + ${this.offset}]`;
        this.parameter = name !== null;
        this.members = null;
    }

    toString() {
        return this.name;
    }
}

class Stack {
    /** @type {Entry[]} */ entries = [];
    offset = 0;
    maxOffset = 0;
    parameterOffset = 0;

    at(i) {
        return this.entries[i < 0 ? this.entries.length + i : i];
    }

    refer(idx) {
        idx = idx < 0 ? this.entries.length + idx : idx;
        const entry = this.push(Types.ptr(this.at(idx).type));
        entry.reference = idx;
        return entry;
    }

    push(type) {
        const size = getTypeSize(type);
        const alignment = getTypeAlignment(type);

        if (size == 0) {
            this.entries.push(null);
            return this.top();
        }

        while (this.offset % alignment != 0)
            this.offset++;

        this.entries.push(new Entry(type, this.offset, size, alignment));
        this.top().members = type.members ? [] : null;

        let memberOffset = 0;
        if (type.members) type.members.forEach(member => {
            const size = getTypeSize(member);
            const alignment = getTypeAlignment(member);

            while (this.offset % alignment != 0) {
                this.offset++;
                memberOffset++;
            }
        
            this.top().members.push(new Entry(
                member,
                memberOffset,
                size,
                alignment,
                `[rsp + ${this.offset}]`
            ));
            
            this.offset += size;
            memberOffset += size;
        }); else {
            this.offset += size;
        }

        while (this.offset % alignment != 0)
            this.offset++;
        
        this.maxOffset = Math.max(this.offset, this.maxOffset);

        return this.top();
    }

    pop() {
        const entry = this.entries.pop();
        this.offset = this.top() && !this.top().parameter ? this.top().offset + this.top().size : 0;
        return entry;
    }

    top() {
        return this.entries[this.entries.length - 1];
    }

    parameter(type) {
        const size = getTypeSize(type);
        const alignment = getTypeAlignment(type);

        while (this.parameterOffset % alignment != 0)
            this.parameterOffset++;

        this.entries.push(new Entry(type, this.parameterOffset, size, alignment, `[r10 + ${this.parameterOffset}]`));
        this.top().members = type.members ? [] : null;

        let memberOffset = 0;
        if (type.members) type.members.forEach(member => {
            const size = getTypeSize(member);
            const alignment = getTypeAlignment(member);

            while (this.parameterOffset % alignment != 0) {
                this.parameterOffset++;
                memberOffset++;
            }
          
            this.top().members.push(new Entry(
                member,
                memberOffset,
                size,
                alignment,
                `[r10 + ${this.parameterOffset}]`
            ));
            
            this.parameterOffset += size;
            memberOffset += size;
        }); else {
            this.parameterOffset += size;
        }

        while (this.parameterOffset % alignment != 0)
            this.parameterOffset++;
        
        return this.top();
    }
}

/**
 * @param {Types.Type} type 
 * @returns {number}
 */
function getTypeSize(type) {
    if (['never', 'none'].includes(type.name))
        return 0;

    if (type === Types.bool)
        return 1;

    if (type.length) {
        return type.length / 8;
    }

    if (type.callable || type.pointer) {
        return 8;
    }

    if (type.members) {
        let offset = 0;
        let maxAlign = 0;
        
        for (const member of type.members) {
            const align = getTypeAlignment(member);
            while (offset % align != 0) offset++;
            offset += getTypeSize(member);
            maxAlign = Math.max(maxAlign, align);
        }
        while (offset % maxAlign != 0) offset++;
        return offset;
    }

    console.log(type);
    throw new Error(`unimplemented: ${type}`);
}

/**
 * @param {Types.Type} type 
 * @returns {number}
 */
function getTypeAlignment(type) {
    if (['never', 'none'].includes(type.name))
        return 0;

    if (type === Types.bool)
        return 1;

    if (type.length) {
        return type.length / 8;
    }

    if (type.callable || type.pointer) {
        return 8;
    }

    if (type.members) {
        let maxAlign = 0;
        for (const member of type.members)
            maxAlign = Math.max(maxAlign, getTypeAlignment(member));
        return maxAlign;
    }
    
    console.log(type);
    throw new Error(`unimplemented: ${type}`);
}

function copyToMemory(dst, src, size) {
    if (size == 0) return [];

    const reg = rax[size];

    if (reg) return [
        `mov ${reg}, ${src}`,
        `mov ${dst}, ${reg}`,
    ];

    return [
        `lea rsi, ${src}`,
        `lea rdi, ${dst}`,
        `mov rcx, ${size}`,
        `rep movsb`
    ];

    throw new Error(`${dst}, ${src}, ${size}`);
}
