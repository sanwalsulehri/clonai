const clones = [];

export function createClone({
  name,
  personality,
  style,
  tone,
  responseLength,
  goals,
  doNotUse = "",
}) {
  const clone = {
    id: crypto.randomUUID(),
    name,
    personality,
    style,
    tone,
    responseLength,
    goals,
    doNotUse,
  };

  clones.push(clone);
  return clone;
}

export function findCloneById(id) {
  return clones.find((clone) => clone.id === id);
}
