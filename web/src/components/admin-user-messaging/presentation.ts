import type {
  AdminAudienceUser,
  AdminSiteMessage
} from "../../types";

export function targetLabel(
  item:
    AdminSiteMessage
) {
  if (
    item.targetType ===
    "all"
  ) {
    return "全部已启用用户";
  }

  if (
    item.targetType ===
    "group"
  ) {
    return (
      item.targetGroupName ||
      "已删除分组"
    );
  }

  return (
    item.targetUsername ||
    "已删除用户"
  );
}

export function statusLabel(
  status:
    AdminAudienceUser["status"]
) {
  if (
    status === "active"
  ) {
    return "已启用";
  }

  if (
    status === "pending"
  ) {
    return "待审核";
  }

  if (
    status === "disabled"
  ) {
    return "已封禁";
  }

  return "已拒绝";
}

export function kindLabel(
  kind:
    AdminSiteMessage["kind"]
) {
  if (
    kind === "warning"
  ) {
    return "重要提醒";
  }

  if (
    kind === "success"
  ) {
    return "好消息";
  }

  return "普通通知";
}

export function readRate(
  item:
    AdminSiteMessage
) {
  if (
    item.deliveredCount < 1
  ) {
    return 0;
  }

  return Math.round(
    item.readCount /
    item.deliveredCount *
    100
  );
}
