// Sometimes Jest can have issues when trying to spy on an internal module. Import
// and use this function as a workaround at the top of your test.
//
// Credit: https://github.com/facebook/jest/issues/6914#issuecomment-654710111
const { defineProperty } = Object;

Object.defineProperty = function (object, name, meta) {
  if (meta.get && !meta.configurable) {
    // it might be an ES6 exports object
    return defineProperty(object, name, {
      ...meta,
      configurable: true, // prevent freezing
    });
  }

  return defineProperty(object, name, meta);
};

// Define TextEncoder globally for tests. The TextEncoder API is natively available in browser environments
// but not necessarily in Node.js, which is what Jest uses for its test environment.
import { TextDecoder, TextEncoder } from 'util';
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

export {};
