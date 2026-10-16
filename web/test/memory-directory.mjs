// In-memory File System Access directory tree: directories and text files.
export function memoryDirectory(name = "root") {
  const children = new Map();
  const notFound = () => Object.assign(new Error(`missing ${name}`), { name: "NotFoundError" });
  return {
    kind: "directory",
    name,
    children,
    async getDirectoryHandle(child, { create } = {}) {
      if (!children.has(child)) {
        if (!create) throw notFound();
        children.set(child, memoryDirectory(child));
      }
      return children.get(child);
    },
    async getFileHandle(child, { create } = {}) {
      if (!children.has(child)) {
        if (!create) throw notFound();
        children.set(child, { kind: "file", text: "" });
      }
      const file = children.get(child);
      return {
        getFile: async () => ({ text: async () => file.text }),
        createWritable: async () => ({ write: async (text) => { file.text = text; }, close: async () => {} }),
      };
    },
    async *entries() {
      yield* children.entries();
    },
  };
}
