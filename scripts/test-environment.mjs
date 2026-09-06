export function testEnvironment(parent, temporaryHome) {
  const env={NODE_ENV:'test',HOME:temporaryHome,USERPROFILE:temporaryHome};
  for(const key of ['PATH','SystemRoot','WINDIR','TMPDIR','TEMP','TMP']) {
    if(parent[key])env[key]=parent[key];
  }
  return env;
}
