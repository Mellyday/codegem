import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Generate a random lowercase string (a-z and underscore) of given length
export function randomString(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz_'
  let out = ''
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * alphabet.length)
    out += alphabet[idx]
  }
  return out
}

// Fisher–Yates shuffle returning a new array
export function shuffleArray<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a
}
