// Stands in for a runtime outside node_modules that asks to be looked past.
export const state = (Signal, value) => new Signal.State(value);
