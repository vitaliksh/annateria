// In-memory File System Access directory tree with binary files and injectable write failures (for backup-store tests).
// `state.failures` is a list of { match: RegExp, name: "InvalidStateError", times: n } applied when a write is closed.
export function binaryDirectory(name = "root", state = { failures: [] }) {
  const children = new Map();
  const notFound = () => Object.assign(new Error(`missing ${name}`), { name: "NotFoundError" });
  const fileHandle = (childName) => {
    const file = children.get(childName);
    return {
      kind: "file",
      name: childName,
      getFile: async () => ({ size: file.bytes.length, arrayBuffer: async () => file.bytes.slice().buffer, text: async () => new TextDecoder().decode(file.bytes) }),
      createWritable: async () => {
        let next = file.bytes;
        return {
          write: async (data) => { next = typeof data === "string" ? new TextEncoder().encode(data) : data?.arrayBuffer ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data); },
          close: async () => {
            const failure = state.failures.find((f) => f.times > 0 && f.match.test(childName));
            if (failure) {
              failure.times -= 1;
              throw Object.assign(new Error("simulated"), { name: failure.name });
            }
            file.bytes = next;
          },
        };
      },
    };
  };
  return {
    kind: "directory",
    name,
    children,
    state,
    async getDirectoryHandle(child, { create } = {}) {
      if (!children.has(child)) {
        if (!create) throw notFound();
        children.set(child, binaryDirectory(child, state));
      }
      return children.get(child);
    },
    async getFileHandle(child, { create } = {}) {
      if (!children.has(child)) {
        if (!create) throw notFound();
        children.set(child, { kind: "file", bytes: new Uint8Array(0) });
      }
      return fileHandle(child);
    },
    async *entries() {
      for (const [childName, child] of children) yield [childName, child.kind === "file" ? fileHandle(childName) : child];
    },
  };
}

// Creates a file at a "/"-separated path.
export async function putFile(root, path, content) {
  const parts = path.split("/");
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
  const writable = await (await directory.getFileHandle(parts.at(-1), { create: true })).createWritable();
  await writable.write(content);
  await writable.close();
}

export async function readFileBytes(root, path) {
  const parts = path.split("/");
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  return new Uint8Array(await (await (await directory.getFileHandle(parts.at(-1))).getFile()).arrayBuffer());
}

// All file paths below a directory, sorted.
export async function listPaths(directory, prefix = "") {
  const paths = [];
  for await (const [childName, child] of directory.entries()) {
    if (child.kind === "directory") paths.push(...(await listPaths(child, `${prefix}${childName}/`)));
    else paths.push(`${prefix}${childName}`);
  }
  return paths.sort();
}
