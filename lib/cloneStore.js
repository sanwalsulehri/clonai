const clones = [];

export function createClone({ name, personality, style }) {
  const clone = {
    id: crypto.randomUUID(),
    name,
    personality,
    style,
  };

  clones.push(clone);
  return clone;
}

export function findCloneById(id) {
  return clones.find((clone) => clone.id === id);
}
