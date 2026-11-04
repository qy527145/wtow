import { type ReactNode, useState } from "react";
import { Button, Dialog, ErrorNote, Field, Textarea } from "./ui";

/** 需要填写原因的确认弹窗：取消、释放、重开、忽略等操作服务端都要求 reason。 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  danger,
  pending,
  error,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmText: string;
  danger?: boolean;
  pending?: boolean;
  error?: unknown;
  onSubmit: (reason: string) => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      width="sm"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onSubmit(reason.trim());
        }}
      >
        {children}
        <Field label="原因" hint="会写进审计记录，团队里其他人能看到。">
          <Textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={pending}
            disabled={!reason.trim()}
          >
            {confirmText}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
