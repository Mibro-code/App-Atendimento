import type { NextAuthConfig } from 'next-auth';
// Middleware only performs navigation guards. Actual authentication is always
// revalidated by server-side auth(), including every protected API/action.
export default {
  session:{strategy:'jwt'},trustHost:true,pages:{signIn:'/login'},providers:[],
  callbacks:{session:async({session,token})=>{if(session.user){session.user.id=token.id as string;session.user.role=token.role;}return session;}}
} satisfies NextAuthConfig;
