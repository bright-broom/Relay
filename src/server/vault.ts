import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
function encryptionKey(): Buffer {
  const value=process.env.TOKEN_ENCRYPTION_KEY ?? '';
  if(!/^[A-Za-z0-9+/]{43}=$/.test(value))throw new Error('configuration');
  const key=Buffer.from(value,'base64');
  if(key.length!==32)throw new Error('configuration');
  return key;
}
export function calendarConfigured(): boolean {try{encryptionKey();return true}catch{return false}}
export function seal(value: string, subject: string): string {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
  cipher.setAAD(Buffer.from('relay-calendar:'+subject));
  const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');
}
export function unseal(value: string, subject: string): string {
  const [version,iv,tag,data,...extra]=value.split('.');
  if(version!=='v1'||!iv||!tag||!data||extra.length)throw new Error('invalidCiphertext');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv,'base64url'));
  decipher.setAAD(Buffer.from('relay-calendar:'+subject));decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8');
}
