// three.js ships its types separately (@types/three). PTO keeps the dependency surface small
// and treats the engine as untyped at this boundary; the rendering layer is the only consumer.
declare module 'three';
declare module 'three/examples/jsm/*';
