import type { NextApiRequest, NextApiResponse } from 'next';
import { jsonRes } from '@/service/response';
import { authUser, getApiKey } from '@/service/utils/auth';
import { withNextCors } from '@/service/utils/tools';
import { getOpenAIApi } from '@/service/utils/chat/openai';
import { embeddingModel } from '@/constants/model';
import { axiosConfig } from '@/service/utils/tools';
import { pushGenerateVectorBill } from '@/service/events/pushBill';
import { ApiKeyType } from '@/service/utils/auth';
import { OpenAiChatEnum } from '@/constants/model';

type Props = {
  input: string[];
  type?: ApiKeyType;
};
type Response = number[][];

export default withNextCors(async function handler(req: NextApiRequest, res: NextApiResponse<any>) {
  try {
    const { userId } = await authUser({ req });
    let { input, type } = req.query as Props;

    if (!Array.isArray(input)) {
      throw new Error('缺少参数');
    }

    jsonRes<Response>(res, {
      data: await openaiEmbedding({ userId, input, type, mustPay: true })
    });
  } catch (err) {
    console.log(err);
    jsonRes(res, {
      code: 500,
      error: err
    });
  }
});

export async function openaiEmbedding({
  userId,
  input,
  mustPay = false,
  type = 'chat'
}: { userId: string; mustPay?: boolean } & Props) {
  const { userOpenAiKey, systemAuthKey } = await getApiKey({
    model: OpenAiChatEnum.GPT35,
    userId,
    mustPay,
    type
  });

  // 获取 chatAPI
  const chatAPI = getOpenAIApi();

  // 把输入的内容转成向量
  const result = await chatAPI
    .createEmbedding(
      {
        model: embeddingModel,
        input
      },
      {
        timeout: 60000,
        ...axiosConfig(userOpenAiKey || systemAuthKey)
      }
    )
    .then((res) => ({
      tokenLen: res.data.usage.total_tokens || 0,
      vectors: res.data.data.map((item) => item.embedding)
    }));

  pushGenerateVectorBill({
    isPay: !userOpenAiKey,
    userId,
    text: input.join(''),
    tokenLen: result.tokenLen
  });

  return result.vectors;
}
