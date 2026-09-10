import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ROLES, type Role } from '@msp/shared';

/**
 * A real account. This is the collection D-008 deliberately did not build, and D-037 is why
 * it exists now: an admin creating a business, and a business creating its own participants,
 * cannot be done against a hardcoded array.
 *
 * What changed is authentication only. `AuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()`
 * and every boundary test are untouched -- that seam was the whole point of D-008.
 */
@Schema({ collection: 'users', timestamps: true })
export class User {
  /**
   * A STRING id, like ClientOrg and for the same reason: every collection in this system
   * already stores `participantId` as a string and compares it as one.
   *
   * It is also a migration constraint rather than a style choice. The deployed database has
   * assignments, sessions, reports and participant stats all referencing `u-participant-1`
   * through `u-participant-10` verbatim. Generating fresh ids for the demo roster would orphan
   * every one of them -- the dashboard, the notifications and the People tab would go blank
   * and nothing would throw. The seed therefore upserts on these exact ids (D-037).
   *
   * `match` because this string is copied into `participantId` on sessions, assignments,
   * reports and append-only verification results, where it lives forever. There is no default:
   * an explicitly declared String `_id` is not auto-generated, so a caller that forgets to
   * mint one gets a validation error rather than an ObjectId nothing else can join against.
   */
  @Prop({
    type: String,
    required: true,
    match: /^u-[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    maxlength: 64,
  })
  _id!: string;

  /**
   * `match` as well as length, and here for the same reason D-010 bounded `radiusM` on the
   * schema: a seed or a migration must not be able to reach past it. The characters matter
   * more than they look. `lowercase: true` is `toLowerCase()`, not a Unicode case-fold, so
   * without this a username could carry RTL overrides, homoglyphs or a dotted capital I --
   * which lowercases to a two-codepoint sequence and indexes as a DIFFERENT key from the
   * ASCII letter it renders as. On a login form that is an impersonation primitive.
   */
  @Prop({
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    minlength: 3,
    maxlength: 32,
  })
  username!: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  displayName!: string;

  /**
   * scrypt, encoded with its own parameters. Never plaintext, and never returned:
   * `select: false` means a careless `find()` in some future console feature cannot leak the
   * whole hash table. `AuthService.login` is the only caller that asks for it, by name.
   *
   * Two limits on that protection, because it is easy to over-trust. Projections do not apply
   * to `aggregate()` or `$lookup`, so an aggregation over this collection would return the
   * hash -- keep display-name resolution a plain `find({_id: {$in: []}})`. And an unselected
   * `required` path is skipped by validation on an existing document, so a load-modify-save
   * through a projected doc would silently drop the hash and leave an account that cannot log
   * in. Every write here is therefore an explicit `$set`, never a `.save()` of a loaded doc.
   */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true, type: String, enum: ROLES })
  role!: Role;

  /**
   * The tenancy key, and an invariant rather than a free field.
   *
   * An admin has no organisation and sees every one. A business or participant WITHOUT one is
   * unreachable: `orgScope` filters on `null`, so their console is empty and their assignments
   * invisible -- a broken account that looks fine in a list.
   *
   * Enforced in the two hooks below rather than by a field validator. A field validator was
   * the first attempt and it does not work: on `updateOne`/`findOneAndUpdate` Mongoose does
   * not run validators at all unless asked, and when asked it binds `this` to the QUERY, which
   * has no `role` -- so the check silently passes on exactly the paths that can reach the
   * invalid state. Found by the schema-reviewer pass on this branch.
   */
  @Prop({ type: String, default: null, ref: 'ClientOrg' })
  clientOrgId!: string | null;

  /**
   * Deactivation instead of deletion.
   *
   * Sessions, reports and verification results reference a participant by id forever, and
   * verification results are append-only (rule 8) -- deleting the user behind a completed
   * visit would leave a verdict attributed to nobody. The delete hook below enforces that;
   * the comment on its own did not.
   */
  @Prop({ required: true, default: true })
  active!: boolean;

  /**
   * Who created this account. Null for the seeded roster, which nobody created.
   *
   * An admin creating a business and a business creating participants are the two most
   * consequential writes this feature adds, and this codebase keeps an append-only transition
   * audit and a separate `reviewAction` document for human overrides. Recording the actor is
   * consistent with that rather than extra.
   */
  @Prop({ type: String, default: null })
  createdBy!: string | null;
}
export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

/**
 * The roster query: "the participants of this org", which is what the assignment form reads
 * and what a business user is allowed to see. Compound rather than two single-field indexes
 * because neither half is selective on its own -- role has three values and, for a business
 * user, clientOrgId is a constant.
 */
UserSchema.index({ clientOrgId: 1, role: 1 });

/** The one combination that must never exist, stated once and used by both hooks. */
export function orgMatchesRole(role: Role | undefined, clientOrgId: unknown): boolean {
  if (!role) return true;
  return role === 'admin'
    ? clientOrgId === null || clientOrgId === undefined
    : typeof clientOrgId === 'string' && clientOrgId.length > 0;
}

const ORG_ROLE_MESSAGE =
  'admin must have clientOrgId null, and every other role must have one. An account whose ' +
  'role and organisation disagree is unreachable rather than broken-looking: the tenancy ' +
  'filter matches nothing and the console is simply empty.';

/**
 * Checked on create, where `this` really is the document and every path is validated.
 */
UserSchema.pre('validate', function () {
  if (!orgMatchesRole(this.role, this.clientOrgId)) {
    this.invalidate('clientOrgId', ORG_ROLE_MESSAGE);
  }
});

/**
 * And refused on update, because that is the path a field validator cannot see.
 *
 * `role` and `clientOrgId` are set once, at creation. Nothing in this system moves an account
 * between organisations or changes what it is -- `setActive` touches `active` and nothing
 * else -- so rather than trying to re-derive the invariant from a partial `$set` (which cannot
 * be done: `$set: { role: 'admin' }` alone carries no organisation to check it against), the
 * update is refused outright. Same enforcement shape as the append-only hook on
 * `SessionEventSchema`, and the same reason: a comment claiming an invariant does not hold it.
 */
UserSchema.pre(/^(updateOne|updateMany|findOneAndUpdate|findOneAndReplace|replaceOne)$/, function (
  this: { getUpdate: () => Record<string, unknown> | null },
) {
  const update = this.getUpdate() ?? {};
  const touched = new Set<string>();
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$')) {
      for (const path of Object.keys((value ?? {}) as Record<string, unknown>)) {
        touched.add(path);
      }
    } else {
      // A replacement document rather than an operator: every field is being written.
      touched.add(key);
    }
  }
  for (const guarded of ['role', 'clientOrgId', '_id', 'username']) {
    if (touched.has(guarded)) {
      throw new Error(
        `users.${guarded} is set once, at creation (D-037). ${ORG_ROLE_MESSAGE} ` +
          'Ids are also copied into sessions, reports and append-only verification results, ' +
          'so changing one here orphans them silently. Create a new account instead.',
      );
    }
  }
});

/**
 * No deletion. The `active` flag exists precisely so that this is never needed, and a verdict
 * attributed to a participant who no longer exists is unreadable rather than merely untidy.
 */
UserSchema.pre(/^(deleteOne|deleteMany|findOneAndDelete)$/, function () {
  throw new Error(
    'users are never deleted: sessions, reports and append-only verification results ' +
      '(CLAUDE.md rule 8) reference a participant by id forever, so removing the account ' +
      'leaves a verdict attributed to nobody. Set `active: false` instead.',
  );
});

/**
 * Second line of defence on the hash: even if some future caller does `.select('+passwordHash')`
 * and returns the document straight out of a controller, it does not serialise.
 */
UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete (ret as unknown as Record<string, unknown>).passwordHash;
    return ret;
  },
});
