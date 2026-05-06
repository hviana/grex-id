export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SettingValue = JsonValue;

export type RevalidationMode = "lazy" | "blocking";

export type OwnLayer =
  | {
    found: true;
    value: SettingValue;
    revision: string;
  }
  | {
    found: false;
    revision: string;
  };

export type RawLayer = OwnLayer & { dependencyKey: string };

export type ResolvedLayer =
  | {
    found: true;
    value: SettingValue;
    dependencyKey: string;
  }
  | {
    found: false;
    dependencyKey: string;
  };

export type NormalizedTenant =
  | { level: "global" }
  | {
    level: "system";
    systemId: string;
  }
  | {
    level: "company";
    systemId: string;
    companyId: string;
  }
  | {
    level: "actor";
    systemId: string;
    companyId: string;
    actorId: string;
  };

export type LayerMerger = (
  parent: ResolvedLayer,
  child: RawLayer,
) => ResolvedLayer;
