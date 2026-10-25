export const FIELD = { width: 105, height: 68, padding: 4, scale: 10 };
export const project = (x: number, y: number) => ({ x: (x + FIELD.padding) * FIELD.scale, y: (y + FIELD.padding) * FIELD.scale });
