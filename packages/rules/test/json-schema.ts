// Validateur JSON Schema minimal (sous-ensemble utilisé par spec/*.schema.json), écrit ici
// pour ne pas ajouter de dépendance : $ref local (#/$defs/...), type, enum, const, properties,
// required, additionalProperties, items, minItems, minimum, maximum, exclusiveMinimum,
// minLength, pattern. Mots-clés inconnus (title, description, $id...) ignorés.

type Schema = { [k: string]: unknown };

function isObject(v: unknown): v is Schema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
}

function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith("#/")) throw new Error(`$ref non pris en charge : ${ref}`);
  let cur: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    cur = isObject(cur) ? cur[part] : undefined;
  }
  if (!isObject(cur)) throw new Error(`$ref introuvable : ${ref}`);
  return cur;
}

export function validate(root: Schema, value: unknown, schema: Schema = root, path = "$"): string[] {
  const errors: string[] = [];
  const ref = schema["$ref"];
  if (typeof ref === "string") errors.push(...validate(root, value, resolveRef(root, ref), path));

  const type = schema["type"];
  if (type !== undefined) {
    const types = Array.isArray(type) ? (type as string[]) : [type as string];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path} : type ${types.join("|")} attendu, obtenu ${typeOf(value)}`);
      return errors;
    }
  }
  if ("const" in schema && value !== schema["const"]) errors.push(`${path} : const ${JSON.stringify(schema["const"])} attendu`);
  const en = schema["enum"];
  if (Array.isArray(en) && !en.includes(value)) errors.push(`${path} : valeur hors énumération (${JSON.stringify(value)})`);

  if (typeof value === "number") {
    const mn = schema["minimum"];
    const mx = schema["maximum"];
    const emn = schema["exclusiveMinimum"];
    if (typeof mn === "number" && value < mn) errors.push(`${path} : ${value} < minimum ${mn}`);
    if (typeof mx === "number" && value > mx) errors.push(`${path} : ${value} > maximum ${mx}`);
    if (typeof emn === "number" && value <= emn) errors.push(`${path} : ${value} <= exclusiveMinimum ${emn}`);
  }
  if (typeof value === "string") {
    const ml = schema["minLength"];
    const pat = schema["pattern"];
    if (typeof ml === "number" && value.length < ml) errors.push(`${path} : texte trop court`);
    if (typeof pat === "string" && !new RegExp(pat).test(value)) errors.push(`${path} : ne respecte pas ${pat}`);
  }
  if (Array.isArray(value)) {
    const mi = schema["minItems"];
    if (typeof mi === "number" && value.length < mi) errors.push(`${path} : au moins ${mi} éléments`);
    const items = schema["items"];
    if (isObject(items)) value.forEach((v, i) => errors.push(...validate(root, v, items, `${path}[${i}]`)));
  }
  if (isObject(value)) {
    const props = isObject(schema["properties"]) ? schema["properties"] : {};
    const req = schema["required"];
    if (Array.isArray(req)) {
      for (const k of req) if (!(String(k) in value)) errors.push(`${path} : propriété requise absente (${String(k)})`);
    }
    for (const k of Object.keys(value)) {
      const sub = props[k];
      if (isObject(sub)) errors.push(...validate(root, value[k], sub, `${path}.${k}`));
      else {
        const ap = schema["additionalProperties"];
        if (ap === false) errors.push(`${path} : propriété inattendue (${k})`);
        else if (isObject(ap)) errors.push(...validate(root, value[k], ap, `${path}.${k}`));
      }
    }
  }
  return errors;
}
