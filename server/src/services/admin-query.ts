import type { RowDataPacket } from "mysql2/promise";
import type { AppDatabase } from "../db/database.js";
import { mysqlDateToIso } from "../db/database.js";

export interface PageInput {
  page: number;
  pageSize: number;
}

export interface PageResult<T> {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function createAdminQueryService(database: AppDatabase) {
  async function dashboard() {
    const [[users], [usage], [credits], [history], [daily], [models]] = await Promise.all([
      database.pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) total,
          SUM(status = 'pending') pending,
          SUM(status = 'active') active,
          SUM(status = 'disabled') disabled,
          SUM(status = 'rejected') rejected
         FROM app_users`
      ),
      database.pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) total,
          SUM(status = 'success') success,
          SUM(status = 'failed') failed,
          COALESCE(SUM(image_count), 0) images,
          COALESCE(AVG(duration_ms), 0) average_duration_ms
         FROM app_usage_records
         WHERE created_at >= UTC_DATE()`
      ),
      database.pool.query<RowDataPacket[]>(
        `SELECT
          COALESCE(SUM(CASE WHEN type = 'generation_charge' THEN -amount_cents ELSE 0 END), 0) spent_cents,
          COALESCE(SUM(CASE WHEN type = 'card_recharge' THEN amount_cents ELSE 0 END), 0) recharged_cents
         FROM app_credit_transactions
         WHERE created_at >= UTC_DATE()`
      ),
      database.pool.query<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT h.id) histories, COUNT(i.id) images
         FROM app_history_records h
         LEFT JOIN app_history_images i ON i.history_id = h.id
         WHERE h.deleted_at IS NULL`
      ),
      database.pool.query<RowDataPacket[]>(
        `WITH RECURSIVE dates AS (
           SELECT UTC_DATE() - INTERVAL 6 DAY AS day
           UNION ALL SELECT day + INTERVAL 1 DAY FROM dates WHERE day < UTC_DATE()
         )
         SELECT DATE_FORMAT(d.day, '%m-%d') label,
                COALESCE(COUNT(u.id), 0) usage_count,
                COALESCE(SUM(u.image_count), 0) image_count
         FROM dates d
         LEFT JOIN app_usage_records u ON DATE(u.created_at) = d.day
         GROUP BY d.day ORDER BY d.day`
      ),
      database.pool.query<RowDataPacket[]>(
        `SELECT provider, model, COUNT(*) usage_count, COALESCE(SUM(image_count), 0) image_count
         FROM app_usage_records
         WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
         GROUP BY provider, model
         ORDER BY usage_count DESC LIMIT 10`
      )
    ]);

    const user = users[0] ?? ({} as RowDataPacket);
    const todayUsage = usage[0] ?? ({} as RowDataPacket);
    const todayCredits = credits[0] ?? ({} as RowDataPacket);
    const stored = history[0] ?? ({} as RowDataPacket);
    return {
      users: {
        total: Number(user.total || 0), pending: Number(user.pending || 0), active: Number(user.active || 0),
        disabled: Number(user.disabled || 0), rejected: Number(user.rejected || 0)
      },
      today: {
        usage: Number(todayUsage.total || 0), success: Number(todayUsage.success || 0), failed: Number(todayUsage.failed || 0),
        images: Number(todayUsage.images || 0), averageDurationMs: Number(todayUsage.average_duration_ms || 0),
        spentPoints: Number(todayCredits.spent_cents || 0) / 100,
        rechargedPoints: Number(todayCredits.recharged_cents || 0) / 100
      },
      storage: { histories: Number(stored.histories || 0), images: Number(stored.images || 0) },
      daily: daily.map((row) => ({ label: String(row.label), usageCount: Number(row.usage_count), imageCount: Number(row.image_count) })),
      models: models.map((row) => ({ provider: String(row.provider), model: String(row.model), usageCount: Number(row.usage_count), imageCount: Number(row.image_count) }))
    };
  }

  async function listUsers(input: PageInput & { search?: string; status?: string }): Promise<PageResult<Record<string, unknown>>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (input.search) { const q = `%${escapeLike(input.search)}%`; where.push("(u.username LIKE ? OR COALESCE(u.nickname, '') LIKE ?)"); params.push(q, q); }
    if (["pending", "active", "disabled", "rejected"].includes(input.status || "")) { where.push("u.status = ?"); params.push(input.status); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [countRows] = await database.pool.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM app_users u ${clause}`, params);
    const [rows] = await database.pool.query<RowDataPacket[]>(
      `SELECT u.*,
        (SELECT COUNT(*) FROM app_login_records l WHERE l.user_id = u.id) login_count,
        (SELECT COUNT(*) FROM app_usage_records x WHERE x.user_id = u.id) usage_count,
        (SELECT l2.client_ip FROM app_login_records l2 WHERE l2.user_id = u.id AND l2.success = 1 ORDER BY l2.created_at DESC LIMIT 1) last_login_ip
       FROM app_users u ${clause}
       ORDER BY (u.status = 'pending') DESC, u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, input.pageSize, (input.page - 1) * input.pageSize]
    );
    return page(rows.map(mapUser), Number(countRows[0]?.total || 0), input);
  }

  async function listUserUsage(userId: string, input: PageInput): Promise<PageResult<Record<string, unknown>>> {
    return listSimple(
      `SELECT COUNT(*) total FROM app_usage_records WHERE user_id = ?`,
      `SELECT * FROM app_usage_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [userId], input, mapUsage
    );
  }

  async function listUserLogins(userId: string, input: PageInput): Promise<PageResult<Record<string, unknown>>> {
    return listSimple(
      `SELECT COUNT(*) total FROM app_login_records WHERE user_id = ?`,
      `SELECT * FROM app_login_records WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [userId], input, mapLogin
    );
  }

  async function listUserCredits(userId: string, input: PageInput): Promise<PageResult<Record<string, unknown>>> {
    return listSimple(
      `SELECT COUNT(*) total FROM app_credit_transactions WHERE user_id = ?`,
      `SELECT * FROM app_credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [userId], input, mapCredit
    );
  }

  async function listCards(input: PageInput & { search?: string; status?: string }): Promise<PageResult<Record<string, unknown>>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (input.search) { where.push("(code_preview LIKE ? OR created_by LIKE ? OR redeemed_by_username LIKE ?)"); const q=`%${escapeLike(input.search)}%`; params.push(q,q,q); }
    if (input.status === "unused") where.push("redeemed_at IS NULL");
    if (input.status === "redeemed") where.push("redeemed_at IS NOT NULL");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [countRows] = await database.pool.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM app_recharge_cards ${clause}`, params);
    const [rows] = await database.pool.query<RowDataPacket[]>(
      `SELECT * FROM app_recharge_cards ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, input.pageSize, (input.page - 1) * input.pageSize]
    );
    return page(rows.map(mapCard), Number(countRows[0]?.total || 0), input);
  }

  async function listAudit(input: PageInput & { search?: string; action?: string }): Promise<PageResult<Record<string, unknown>>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (input.search) { where.push("(actor_username LIKE ? OR summary LIKE ? OR target_id LIKE ?)"); const q=`%${escapeLike(input.search)}%`; params.push(q,q,q); }
    if (input.action) { where.push("action = ?"); params.push(input.action); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [countRows] = await database.pool.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM app_admin_audit_logs ${clause}`, params);
    const [rows] = await database.pool.query<RowDataPacket[]>(
      `SELECT * FROM app_admin_audit_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, input.pageSize, (input.page - 1) * input.pageSize]
    );
    return page(rows.map(mapAudit), Number(countRows[0]?.total || 0), input);
  }

  /**
   * 注意：此方法仅用于内部分页查询，countSql 与 dataSql 必须为硬编码字符串，
   * 严禁拼接任何用户输入（包括用户名、搜索词等）到 SQL 文本中。
   * 所有动态值必须通过 baseParams 参数化传入。
   */
  async function listSimple(
    countSql: string, dataSql: string, baseParams: unknown[], input: PageInput,
    mapper: (row: RowDataPacket) => Record<string, unknown>
  ): Promise<PageResult<Record<string, unknown>>> {
    const [countRows] = await database.pool.query<RowDataPacket[]>(countSql, baseParams);
    const [rows] = await database.pool.query<RowDataPacket[]>(dataSql, [...baseParams, input.pageSize, (input.page - 1) * input.pageSize]);
    return page(rows.map(mapper), Number(countRows[0]?.total || 0), input);
  }

  return { dashboard, listUsers, listUserUsage, listUserLogins, listUserCredits, listCards, listAudit };
}

function page<T>(items: T[], total: number, input: PageInput): PageResult<T> {
  return { items, pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) } };
}
function iso(value: unknown) { return mysqlDateToIso(value) || new Date().toISOString(); }
function nullable(value: unknown) { return value === null || value === undefined || value === "" ? undefined : String(value); }
function mapUser(r: RowDataPacket) { return { id:String(r.id), username:String(r.username), nickname:nullable(r.nickname), adminNote:nullable(r.admin_note), mustChangePassword:Boolean(r.must_change_password)||undefined, role:r.role, status:r.status, createdAt:iso(r.created_at), approvedAt:r.approved_at?iso(r.approved_at):undefined, lastLoginAt:r.last_login_at?iso(r.last_login_at):undefined, credits:Number(r.credit_cents)/100, loginCount:Number(r.login_count||0), usageCount:Number(r.usage_count||0), lastLoginIp:nullable(r.last_login_ip) }; }
function mapUsage(r: RowDataPacket) { return { id:String(r.id), createdAt:iso(r.created_at), provider:String(r.provider), model:String(r.model), operation:r.operation, size:String(r.size), prompt:nullable(r.prompt), imageCount:Number(r.image_count||0), status:r.status, durationMs:r.duration_ms==null?undefined:Number(r.duration_ms), pointsCost:r.points_cost_cents==null?undefined:Number(r.points_cost_cents)/100, pointsRefunded:Boolean(r.points_refunded), error:nullable(r.error) }; }
function mapLogin(r: RowDataPacket) { return { id:String(r.id), username:String(r.username), success:Boolean(r.success), reason:nullable(r.reason), createdAt:iso(r.created_at), clientIp:nullable(r.client_ip), userAgent:nullable(r.user_agent) }; }
function mapCredit(r: RowDataPacket) { return { id:String(r.id), createdAt:iso(r.created_at), type:r.type, amount:Number(r.amount_cents)/100, balanceAfter:Number(r.balance_after_cents)/100, note:nullable(r.note), provider:nullable(r.provider), model:nullable(r.model) }; }
function mapCard(r: RowDataPacket) { const redeemedAt=r.redeemed_at?iso(r.redeemed_at):undefined; return { id:String(r.id), codePreview:String(r.code_preview), points:Number(r.credit_cents)/100, createdAt:iso(r.created_at), createdBy:String(r.created_by), redeemedAt, redeemedByUsername:nullable(r.redeemed_by_username), status:redeemedAt?"redeemed":"unused" }; }
function mapAudit(r: RowDataPacket) { let details; try { details=typeof r.details_json==="string"?JSON.parse(r.details_json):r.details_json; } catch { details=undefined; } return { id:String(r.id), actorUserId:nullable(r.actor_user_id), actorUsername:String(r.actor_username), action:String(r.action), targetType:String(r.target_type), targetId:nullable(r.target_id), summary:String(r.summary), details, clientIp:nullable(r.client_ip), userAgent:nullable(r.user_agent), createdAt:iso(r.created_at) }; }
function escapeLike(value: string) { return value.trim().replace(/[\\%_]/g, (match) => `\\${match}`); }

export type AdminQueryService = ReturnType<typeof createAdminQueryService>;
