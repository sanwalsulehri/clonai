const clones = [];

export function createClone({
  name,
  personality,
  style,
  tone,
  humor,
  responseLength,
  goals,
  doNotUse = "",
  language = "english",
  romanMode = false,
}) {
  const clone = {
    id: crypto.randomUUID(),
    name,
    personality,
    style,
    tone,
    humor,
    responseLength,
    goals,
    doNotUse,
    language: typeof language === "string" ? language.trim() || "english" : "english",
    romanMode: romanMode === true,
  };

  clones.push(clone);
  return clone;
}

export function findCloneById(id) {
  return clones.find((clone) => clone.id === id);
}
