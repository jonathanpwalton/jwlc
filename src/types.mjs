import assert from 'assert';

export class Type {
    constructor(name) {
        this.name = name;
    }

    toString() {
        return this.name;
    }
}

export const none = new Type('none');
export const never = new Type('never');

const int = (signed, bits) => {
    const type = new Type(`${signed ? 's' : 'u'}${bits}`);
    type.arithmetic = true;
    type.integral = true;
    type.length = bits;
    type.signed = signed;
    return type;
};

const float = (bits) => {
    const type = new Type(`f${bits}`);
    type.arithmetic = true;
    type.scalar = true;
    type.length = bits;
    return type;
}

export const f32 = float(32);
export const f64 = float(64);
export const u8  = int(false, 8);
export const u16 = int(false, 16);
export const u32 = int(false, 32);
export const u64 = int(false, 64);
export const s8  = int(true, 8);
export const s16 = int(true, 16);
export const s32 = int(true, 32);
export const s64 = int(true, 64);
export const usz = new Type('usz');
export const ssz = new Type('ssz');
export const bool = new Type('bool');

usz.arithmetic = true;
ssz.arithmetic = true;
usz.integral = true;
ssz.integral = true;

const functions = {};

/** @type {(inputs: Type[], output: Type) => Type} */
export const fn = (inputs, output) => {
    const name = `(${inputs.map(i => i.toString()).join(', ')}) => ${output}`;
    if (!(name in functions)) {
        const type = functions[name] = new Type(name);
        type.inputs = inputs;
        type.output = output;
        type.callable = true;
    }
    return functions[name];
};

const pointers = {};

/** @type {(pointee: Type) => Type} */
export const ptr = (pointee) => {
    const name = `ptr[${pointee}]`;
    if (!(name in pointers)) {
        const type = pointers[name] = new Type(name);
        type.pointer = true;
        type.pointee = pointee;
    }
    return pointers[name];
};

export const module = (module) => {
    const type = new Type('module alias');
    type.module = module;
    return type;
}

const objects = {};

export const obj = (properties, visibilities) => {
    assert(visibilities instanceof Array);
    assert(Object.values(properties).length === visibilities.length);
    const name = `{${Object.entries(properties).map(([name, type], i) => `${visibilities[i]} ${name}: ${type}`).join(', ')}}`;
    if (!(name in objects)) {
        const type = objects[name] = new Type(name);
        type.properties = properties;
        type.object = true;
        type.members = Object.values(properties);
        type.visibilities = visibilities;
    }
    return objects[name];
};

const arrays = {};

export const arr = (type) => {
    assert(type instanceof Type);
    const name = `${type}[]`;
    if (!(name in arrays)) {
        const arr = arrays[name] = new Type(name);
        arr.array = true;
        arr.object = true;
        arr.properties = {data: ptr(type), length: usz};
        arr.members = Object.values(arr.properties);
        arr.visibilities = ['readonly', 'readonly'];
    }
    return arrays[name];
}

export const str = arr(u8);
str.name = 'str';

const tuples = {};

export const tuple = (members) => {
    const name = `[${members.map(type => type.toString()).join(', ')}]`;
    if (!(name in tuples)) {
        const type = tuples[name] = new Type(name);
        type.members = members;
        type.tuple = true;
        type.count = members.length;
    }
    return tuples[name];
};

export const ref = (referee) => {
    const type = new Type(`reference to ${referee}`);
    type.reference = true;
    type.referee = referee;
    return type;
};

export const def = (type, name) => {
    const newType = new Type(name);
    for (const prop in type) {
        if (prop === 'name') continue;
        newType[prop] = type[prop];
    }
    return newType;
};
