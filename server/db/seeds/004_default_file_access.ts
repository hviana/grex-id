import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("004_default_file_access");

const seeds = [
  {
    name: "core.fileAccess.names.companyLogos",
    categoryPattern: "/logos/",
    download: {
      isolateSystem: false,
      isolateCompany: false,
      isolateUser: false,
      permissions: [],
    },
    upload: {
      isolateSystem: true,
      isolateCompany: true,
      isolateUser: true,
      permissions: ["core.files.upload.logos"],
      maxFileSizeMB: 5,
      allowedExtensions: ["svg", "png", "jpg", "jpeg", "webp"],
    },
  },
  {
    name: "core.fileAccess.names.userAvatars",
    categoryPattern: "/avatars/",
    download: {
      isolateSystem: false,
      isolateCompany: true,
      isolateUser: true,
      permissions: [],
    },
    upload: {
      isolateSystem: true,
      isolateCompany: true,
      isolateUser: true,
      permissions: ["core.files.upload.avatars"],
      maxFileSizeMB: 2,
      allowedExtensions: ["png", "jpg", "jpeg", "webp"],
    },
  },
  {
    name: "core.fileAccess.names.leadAvatars",
    categoryPattern: "/lead-avatars/",
    download: {
      isolateSystem: false,
      isolateCompany: false,
      isolateUser: false,
      permissions: [],
    },
    upload: {
      isolateSystem: false,
      isolateCompany: false,
      isolateUser: false,
      permissions: [],
      maxFileSizeMB: 2,
      allowedExtensions: ["png", "jpg", "jpeg", "webp"],
    },
  },
];

export async function seed(db: Surreal): Promise<void> {
  const stmts = seeds.map((_s, i) =>
    `IF array::len((SELECT id FROM file_access WHERE name = $n${i})) = 0 {
      CREATE file_access SET name = $n${i}, categoryPattern = $p${i}, download = $d${i}, upload = $u${i}
    }`
  );
  const vars: Record<string, unknown> = {};
  seeds.forEach((s, i) => {
    vars[`n${i}`] = s.name;
    vars[`p${i}`] = s.categoryPattern;
    vars[`d${i}`] = s.download;
    vars[`u${i}`] = s.upload;
  });
  await db.query(stmts.join(";\n"), vars);
  console.log(`[seed] file_access: ${seeds.length} rules ensured`);
}
