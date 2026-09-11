import { requireChatGPTUser } from './chatgpt-auth';
import Office from './office';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireChatGPTUser('/');
  return <Office />;
}
