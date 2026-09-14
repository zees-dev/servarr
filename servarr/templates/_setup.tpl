{{- define "servarr.setup.credentials" -}}
{{- $secret := .Values.setup.existingSecret | default (printf "%s-setup-credentials" .Release.Name) -}}
{{- range $env, $key := dict "SERVARR_USERNAME" "username" "SERVARR_PASSWORD" "password" "SERVARR_MAIL" "mail" }}
- name: {{ $env }}
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: {{ index $.Values.setup.secretKeys $key }}
      optional: {{ eq $key "mail" }}
{{- end }}
{{- if .Values.notifications.telegram.enabled }}
- name: TELEGRAM_CHAT_ID
  value: {{ .Values.notifications.telegram.chat_id | quote }}
- name: TELEGRAM_BOT_APITOKEN
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: telegram-token
{{- end }}
{{- end -}}
