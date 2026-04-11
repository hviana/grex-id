"use client";

import { useCallback, useRef } from "react";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import type { BadgeValue } from "@/src/components/fields/MultiBadgeField";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";

interface TagItem {
  id: string;
  name: string;
  color: string;
}

interface TagSearchProps {
  value: string[];
  onChange: (tagIds: string[]) => void;
  label?: string;
  debounceMs?: number;
}

export default function TagSearch({
  value,
  onChange,
  label,
  debounceMs = 300,
}: TagSearchProps) {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const tagMapRef = useRef<Map<string, TagItem>>(new Map());

  const fetchTags = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      const headers: HeadersInit = {};
      if (systemToken) {
        headers["Authorization"] = `Bearer ${systemToken}`;
      }
      const res = await fetch(
        `/api/tags?search=${encodeURIComponent(search)}`,
        { headers },
      );
      const json = await res.json();
      const tags: TagItem[] = json.data ?? [];

      for (const tag of tags) {
        tagMapRef.current.set(tag.name, tag);
      }

      return tags.map((tag) => ({ name: tag.name, color: tag.color }));
    },
    [systemToken],
  );

  const badgeValue: BadgeValue[] = value.map((id) => {
    for (const tag of tagMapRef.current.values()) {
      if (tag.id === id) {
        return { name: tag.name, color: tag.color };
      }
    }
    return { name: id };
  });

  const handleChange = (badges: BadgeValue[]) => {
    const ids = badges.map((badge) => {
      const name = typeof badge === "string" ? badge : badge.name;
      const tag = tagMapRef.current.get(name);
      return tag?.id ?? name;
    });
    onChange(ids);
  };

  return (
    <MultiBadgeField
      name={label ?? t("common.tags")}
      mode="search"
      value={badgeValue}
      onChange={handleChange}
      fetchFn={fetchTags}
      formatHint={t("common.tags.searchPlaceholder")}
      debounceMs={debounceMs}
    />
  );
}
