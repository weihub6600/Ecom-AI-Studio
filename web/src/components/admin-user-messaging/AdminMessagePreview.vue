<script setup lang="ts">
const props = defineProps<{
  kind:
    | "info"
    | "success"
    | "warning";
  title: string;
  content: string;
}>();
</script>

<template>
  <aside class="reach-preview">
    <span class="preview-kicker">
      LIVE PREVIEW
    </span>

    <div class="preview-device">
      <div class="preview-device-head">
        <span>ZHE AI</span>
        <i>消息中心</i>
      </div>

      <article>
        <header>
          <i
            :class="props.kind"
          >
            {{
              props.kind === "warning"
                ? "重要提醒"
                : props.kind === "success"
                  ? "好消息"
                  : "站内通知"
            }}
          </i>

          <time>刚刚</time>
        </header>

        <h4>
          {{
            props.title ||
            "消息标题会显示在这里"
          }}
        </h4>

        <p>
          {{
            props.content ||
            "在左侧输入消息正文，这里会实时展示用户看到的最终效果。"
          }}
        </p>

        <footer>
          <span></span>
          未读
        </footer>
      </article>
    </div>

    <div class="preview-note">
      <span>
        强提醒已启用
      </span>

      <p>
        用户在创作工作台会看到消息铃铛红点和浮层提醒，不必先进入用户后台。
      </p>
    </div>
  </aside>
</template>

<style scoped>
.reach-preview {
  position: sticky;
  top: 14px;
  padding: 18px;
  border: 1px solid #e1e2ea;
  border-radius: 19px;
  background: #fff;
  box-shadow:
    0 12px 34px
    rgba(46, 48, 74, .045);
}

.preview-kicker {
  color: #6d5bd5;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .15em;
}

.preview-device {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #dedbee;
  border-radius: 15px;
  background:
    linear-gradient(
      145deg,
      #f2f1fb,
      #e9ebf6
    );
  box-shadow:
    inset 0 1px 0 #fff;
}

.preview-device-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 5px 11px;
  color: #72758a;
  font-size: 7px;
}

.preview-device-head span {
  font-weight: 900;
  letter-spacing: .12em;
}

.preview-device-head i {
  font-style: normal;
}

.preview-device article {
  min-height: 260px;
  padding: 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow:
    0 12px 30px
    rgba(61, 58, 93, .08);
}

.preview-device article header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.preview-device article header i {
  padding: 4px 7px;
  border-radius: 999px;
  background: #eef0f5;
  color: #676b7e;
  font-size: 7px;
  font-style: normal;
  font-weight: 850;
}

.preview-device article header i.success {
  background: #e9f8ef;
  color: #2e7751;
}

.preview-device article header i.warning {
  background: #fff4dd;
  color: #a66d13;
}

.preview-device article time {
  color: #a0a3b0;
  font-size: 7px;
}

.preview-device h4 {
  margin: 16px 0 8px;
  color: #34374b;
  font-size: 15px;
}

.preview-device p {
  margin: 0;
  color: #6f7386;
  font-size: 9px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.preview-device footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 20px;
  color: #898c9d;
  font-size: 7px;
}

.preview-device footer span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6a58d6;
}

.preview-note {
  margin-top: 10px;
  padding: 11px;
  border: 1px solid #cde8d8;
  border-radius: 11px;
  background: #f0faf4;
}

.preview-note span {
  color: #2e7450;
  font-size: 8px;
  font-weight: 900;
}

.preview-note p {
  margin: 4px 0 0;
  color: #6f8578;
  font-size: 7px;
  line-height: 1.6;
}

@media (max-width: 1180px) {
  .reach-preview {
    position: static;
  }
}
</style>
