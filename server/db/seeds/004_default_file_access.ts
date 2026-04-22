import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("004_default_file_access");

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
    maxFileSizeMB: number;
    allowedExtensions: string[];
  };
}

const seeds: FileAccessSeed[] = [
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
      isolateSystem: true,
      isolateCompany: true,
      isolateUser: true,
      permissions: ["core.files.upload.leadAvatars"],
      maxFileSizeMB: 2,
      allowedExtensions: ["png", "jpg", "jpeg", "webp"],
    },
  },
];

export async function seed(db: Surreal): Promise<void> {
  for (const seed of seeds) {
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
