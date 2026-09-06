import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ensureAppTables, getAppAccess } from '../api/_lib/app-access.js';

test('membership provisioning and suspension checks need no schema privileges', async () => {
  const db=new PGlite();
  const sql=async(parts,...values)=>(await db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
  const previous={NODE_ENV:process.env.NODE_ENV,ADMIN_EMAILS:process.env.ADMIN_EMAILS};
  try {
    process.env.NODE_ENV='production';process.env.ADMIN_EMAILS='';
    await ensureAppTables(sql);
    await sql`INSERT INTO app_invitations(email,role,status,expires_at) VALUES ('invited@example.test','producer','pending',now()+interval '1 day')`;
    await sql`INSERT INTO app_users(user_id,email,role,status) VALUES ('suspended','suspended@example.test','owner','suspended')`;
    await db.exec(`CREATE ROLE membership_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO membership_runtime;
      GRANT SELECT,INSERT,UPDATE ON app_users,app_invitations TO membership_runtime;
      SET ROLE membership_runtime;`);
    await assert.rejects(sql`CREATE TABLE forbidden(id int)`,{code:'42501'});
    await assert.rejects(sql`ALTER TABLE app_users ADD COLUMN forbidden int`,{code:'42501'});
    const access=await getAppAccess({userId:'invited',email:'invited@example.test'},sql);
    assert.equal(access.role,'producer');assert.ok(access.permissions.includes('assets.write'));
    const repeat=await getAppAccess({userId:'invited',email:'invited@example.test'},sql);
    assert.equal(repeat.user.user_id,'invited');
    const stranger=await getAppAccess({userId:'other',email:'invited@example.test'},sql);
    assert.deepEqual(stranger.permissions,[]);
    assert.deepEqual((await getAppAccess({userId:'suspended',email:'suspended@example.test'},sql)).permissions,[]);
    const [invitation]=await sql`SELECT status,accepted_by FROM app_invitations WHERE email='invited@example.test'`;
    assert.equal(invitation.status,'accepted');assert.equal(invitation.accepted_by,'invited');
  } finally {
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await db.close();
  }
});
