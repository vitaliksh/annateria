// A small JSON-schema subset for tool arguments: object, string, integer, number, boolean, array, with enum, lengths, bounds
// and required. Unknown fields are always refused. validate() checks what the model sent; toGeminiSchema() turns the same
// schema into the `parameters` of a Gemini function declaration, so that the two cannot differ.
const GEMINI_TYPES = { object: "OBJECT", string: "STRING", integer: "INTEGER", number: "NUMBER", boolean: "BOOLEAN", array: "ARRAY" };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

class Invalid extends Error {}

function check(schema, value, path) {
  if (value === null && schema.nullable) return null;
  switch (schema.type) {
    case "object": {
      if (!isObject(value)) throw new Invalid(`${path} must be an object.`);
      const properties = schema.properties ?? {};
      const clean = {};
      for (const [key, item] of Object.entries(value)) {
        if (!(key in properties)) throw new Invalid(`${path}: unknown field "${key}".`);
        // Models sometimes send null for an optional field; that means "not given".
        if (item === null && !(schema.required ?? []).includes(key)) continue;
        clean[key] = check(properties[key], item, `${path}.${key}`);
      }
      for (const key of schema.required ?? []) if (!(key in clean)) throw new Invalid(`${path}: "${key}" is required.`);
      return clean;
    }
    case "string": {
      if (typeof value !== "string") throw new Invalid(`${path} must be a string.`);
      if (schema.minLength !== undefined && value.length < schema.minLength) throw new Invalid(`${path} is too short (at least ${schema.minLength}).`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Invalid(`${path} is too long (at most ${schema.maxLength}).`);
      if (schema.enum && !schema.enum.includes(value)) throw new Invalid(`${path} must be one of: ${schema.enum.join(", ")}.`);
      return value;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) throw new Invalid(`${path} must be ${schema.type === "integer" ? "a whole number" : "a number"}.`);
      if (schema.minimum !== undefined && value < schema.minimum) throw new Invalid(`${path} must be at least ${schema.minimum}.`);
      if (schema.maximum !== undefined && value > schema.maximum) throw new Invalid(`${path} must be at most ${schema.maximum}.`);
      return value;
    }
    case "boolean":
      if (typeof value !== "boolean") throw new Invalid(`${path} must be true or false.`);
      return value;
    case "array": {
      if (!Array.isArray(value)) throw new Invalid(`${path} must be a list.`);
      if (schema.minItems !== undefined && value.length < schema.minItems) throw new Invalid(`${path} needs at least ${schema.minItems} items.`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Invalid(`${path} has too many items (at most ${schema.maxItems}).`);
      return value.map((item, index) => check(schema.items, item, `${path}[${index}]`));
    }
    default:
      throw new Error(`Unsupported schema type "${schema.type}".`);
  }
}

// Returns { ok: true, value } (a cleaned copy) or { ok: false, message }.
export function validate(schema, value, path = "arguments") {
  try {
    return { ok: true, value: check(schema, value, path) };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, message: error.message };
    throw error;
  }
}

export function toGeminiSchema(schema) {
  const out = { type: GEMINI_TYPES[schema.type] };
  for (const key of ["description", "nullable", "enum", "required", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"]) {
    if (schema[key] !== undefined) out[key] = schema[key];
  }
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, item]) => [key, toGeminiSchema(item)]));
  if (schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}
