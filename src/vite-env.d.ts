/*
 * Brings `import.meta.env` into scope for tsc. Declared here rather than via
 * tsconfig's `types`, which would switch global type inclusion from "every
 * installed @types package" to "only this list" for the whole project.
 */
/// <reference types="vite/client" />
