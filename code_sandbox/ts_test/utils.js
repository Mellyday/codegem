"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cn = cn;
exports.randomString = randomString;
exports.shuffleArray = shuffleArray;
const clsx_1 = require("clsx");
const tailwind_merge_1 = require("tailwind-merge");
function cn(...inputs) {
    return (0, tailwind_merge_1.twMerge)((0, clsx_1.clsx)(inputs));
}
// Generate a random lowercase string (a-z and underscore) of given length
function randomString(length) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz_';
    let out = '';
    for (let i = 0; i < length; i++) {
        const idx = Math.floor(Math.random() * alphabet.length);
        out += alphabet[idx];
    }
    return out;
}
// Fisher–Yates shuffle returning a new array
function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}
