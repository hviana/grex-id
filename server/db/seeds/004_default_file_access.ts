import type { Surreal } from "surrealdb";

interface FileAccessSeed {
  name: string;
  categoryPattern: string;
  download: {
    isolateSystem: boolean;
    isolateCompany: boolean;
    isolateUser: boolean;
    permissions: string[];
  };
  upload: {
    isolateSystem: boolean;
    isolateCompany: boolean;
    isolateUser: boolean;
    permissions: string[];
  };
}

const seeds: FileAccessSeed[] = [
  {
    name: "Company Logos",
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
      permissions: ["files:upload:logos"],
    },
  },
  {
    name: "User Avatars",
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
      permissions: ["files:upload:avatars"],
    },
  },
  {
    name: "Lead Avatars",
    categoryPattern: "/lead-avatars/",
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
      permissions: ["files:upload:lead-avatars"],
    },
  },
];

export async function seedDefaultFileAccess(db: Surreal): Promise<void> {
  for (const seed of seeds) {
    const existing = await db.query<[{ id: string }[]]>(
      "SELECT id FROM file_access WHERE name = $name LIMIT 1",
      { name: seed.name },
    );

    if (existing[0] && existing[0].length > 0) continue;

    await db.query(
      `CREATE file_access SET
        name = $name,
        categoryPattern = $categoryPattern,
        download = $download,
        upload = $upload`,
      {
        name: seed.name,
        categoryPattern: seed.categoryPattern,
        download: seed.download,
        upload: seed.upload,
      },
    );

    console.log(`[seed] file_access created: ${seed.name}`);
  }
}
