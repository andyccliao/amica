import { useCallback, useContext, useEffect, useState } from "react";
import { M_PLUS_2, Montserrat } from "next/font/google";
import VrmViewer from "@/components/vrmViewer";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import {
  Message,
  textsToScreenplay,
  Screenplay,
} from "@/features/messages/messages";
import { speakCharacter } from "@/features/messages/speakCharacter";
import { MessageInputContainer } from "@/components/messageInputContainer";
import { SYSTEM_PROMPT } from "@/features/constants/systemPromptConstants";
import { KoeiroParam, DEFAULT_PARAM } from "@/features/constants/koeiroParam";
import { getChatResponseStream } from "@/features/chat/openAiChat";
import { Introduction } from "@/components/introduction";
import { Menu } from "@/components/menu";
import { GitHubLink } from "@/components/githubLink";
import { Meta } from "@/components/meta";
import { I18nProvider } from "@/components/I18nProvider";
import lang, { setLan, TLangs, langs } from "@/i18n";

 const m_plus_2 = M_PLUS_2({
   variable: "--font-m-plus-2",
   display: "swap",
   preload: false,
 });
 
 const montserrat = Montserrat({
   variable: "--font-montserrat",
   display: "swap",
   subsets: ["latin"],
 });

export default function Home() {
  const { viewer } = useContext(ViewerContext);

  const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT);
  const [openAiKey, setOpenAiKey] = useState("");
  const [koeiromapKey, setKoeiromapKey] = useState("");
  const [koeiroParam, setKoeiroParam] = useState<KoeiroParam>(DEFAULT_PARAM);
  const [chatProcessing, setChatProcessing] = useState(false);
  const [chatLog, setChatLog] = useState<Message[]>([]);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [lan, applyLan] = useState(lang);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem("chatVRMParams")) {
      const params = JSON.parse(
        window.localStorage.getItem("chatVRMParams") as string
      );
      setSystemPrompt(params.systemPrompt);
      setKoeiroParam(params.koeiroParam);
      setOpenAiKey(params.openAiKey);
      // setChatLog(params.chatLog);
    }
  }, []);

  useEffect(() => {
    process.nextTick(() =>
      window.localStorage.setItem(
        "chatVRMParams",
        JSON.stringify({ systemPrompt, koeiroParam, openAiKey, chatLog })
      )
    );
  }, [systemPrompt, koeiroParam, chatLog]);

  const handleChangeChatLog = useCallback(
    (targetIndex: number, text: string) => {
      const newChatLog = chatLog.map((v: Message, i) => {
        return i === targetIndex ? { role: v.role, content: text } : v;
      });

      setChatLog(newChatLog);
    },
    [chatLog],
  );

  /**
   * 文ごとに音声を直列でリクエストしながら再生する
   */
  const handleSpeakAi = useCallback(
    async (
      screenplay: Screenplay,
      onStart?: () => void,
      onEnd?: () => void,
    ) => {
      speakCharacter(screenplay, viewer, koeiromapKey, onStart, onEnd);
    },
    [viewer],
  );

  /**
   * アシスタントとの会話を行う
   */
  const handleSendChat = useCallback(
    async (text: string) => {
      if (!openAiKey) {
        setAssistantMessage(lang.DaboardAPIKeyNotEntered);
        return;
      }

      const newMessage = text;

      if (newMessage == null) return;

      setChatProcessing(true);
      // ユーザーの発言を追加して表示
      const messageLog: Message[] = [
        ...chatLog,
        { role: "user", content: newMessage },
      ];
      setChatLog(messageLog);

      // Chat GPTへ
      const messages: Message[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...messageLog,
      ];

      const stream = await getChatResponseStream(messages, openAiKey).catch(
        (e) => {
          console.error(e);
          return null;
        },
      );
      if (stream == null) {
        setChatProcessing(false);
        return;
      }

      const reader = stream.getReader();
      let receivedMessage = "";
      let aiTextLog = "";
      let tag = "";
      const sentences = new Array<string>();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          receivedMessage += value;

          // Detection of tag part of reply content
          const tagMatch = receivedMessage.match(/^\[(.*?)\]/);
          if (tagMatch && tagMatch[0]) {
            tag = tagMatch[0];
            receivedMessage = receivedMessage.slice(tag.length);
          }

          // Cut out and process the response sentence by sentence
          const sentenceMatch = receivedMessage.match(
            /^(.+[\.!\?\n]|.{10,}[,])/,
          );
          if (sentenceMatch && sentenceMatch[0]) {
            const sentence = sentenceMatch[0];
            sentences.push(sentence);
            receivedMessage = receivedMessage
              .slice(sentence.length)
              .trimStart();

            // Skip if the string is unnecessary/impossible to utter.
            if (
              !sentence.replace(
                /^[\s\[\(\{「［（【『〈《〔｛«‹〘〚〛〙›»〕》〉』】）］」\}\)\]]+$/g,
                "",
              )
            ) {
              continue;
            }

            const aiText = `${tag} ${sentence}`;
            const aiTalks = textsToScreenplay([aiText], koeiroParam);
            aiTextLog += aiText;

            // Generate & play audio for each sentence, display responses
            const currentAssistantMessage = sentences.join(" ");
            handleSpeakAi(aiTalks[0], () => {
              setAssistantMessage(currentAssistantMessage);
            });
          }
        }
      } catch (e) {
        setChatProcessing(false);
        console.error(e);
      } finally {
        reader.releaseLock();
      }

      // アシスタントの返答をログに追加
      const messageLogAssistant: Message[] = [
        ...messageLog,
        { role: "assistant", content: aiTextLog },
      ];

      setChatLog(messageLogAssistant);
      setChatProcessing(false);
    },
    [systemPrompt, chatLog, handleSpeakAi, openAiKey, koeiroParam],
  );

  useEffect(() => {
    let lan = "en" as TLangs;
    if (!localStorage.getItem("chatvrm_language")) {
      setLan("en");
    }
    lan = (localStorage.getItem("chatvrm_language") ?? "en") as TLangs;
    applyLan(langs[lan]);
    setSystemPrompt(langs[lan].SettingsCharacterSettingsPrompt);
    setShowContent(true);
  }, []);

  useEffect(() => {
    const base64APIKey = localStorage.getItem("chatvrm_apikey") ?? "";
    if (base64APIKey.length) {
      const apiKey = atob(base64APIKey);
      setOpenAiKey(apiKey);
    }
  }, []);

  if (!showContent) return <></>;
  return (
    <I18nProvider value={lan}>
      <div className={`${m_plus_2.variable} ${montserrat.variable}`}>
        <Meta />
        <Introduction openAiKey={openAiKey} onChangeAiKey={setOpenAiKey} />
        <VrmViewer />
        <MessageInputContainer
          isChatProcessing={chatProcessing}
          onChatProcessStart={handleSendChat}
        />
        <Menu
          openAiKey={openAiKey}
          systemPrompt={systemPrompt}
          chatLog={chatLog}
          koeiroParam={koeiroParam}
          koeiromapKey={koeiromapKey}
          assistantMessage={assistantMessage}
          onChangeAiKey={setOpenAiKey}
          onChangeSystemPrompt={setSystemPrompt}
          onChangeChatLog={handleChangeChatLog}
          onChangeKoeiromapParam={setKoeiroParam}
          onClickResetChatLog={() => setChatLog([])}
          onClickResetSystemPrompt={() => setSystemPrompt(SYSTEM_PROMPT)}
          onChangeKoeiromapKey={setKoeiromapKey}
        />
        <GitHubLink />
      </div>
    </I18nProvider>
  );
}