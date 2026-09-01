import { getMemberRegistrationUrl } from "@/lib/auth-url";

type MemberRegistrationRequest = {
  termsOfServiceAgreed: boolean;
  privacyPolicyAgreed: boolean;
};

type MemberRegistrationResponse = {
  memberId: number;
  role: "USER" | "ADMIN";
};

type ErrorResponse = {
  message?: string;
};

export async function registerMember(
  request: MemberRegistrationRequest,
): Promise<MemberRegistrationResponse> {
  const response = await fetch(getMemberRegistrationUrl(), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as ErrorResponse;

    throw new Error(error.message ?? "가입을 완료하지 못했습니다.");
  }

  return response.json() as Promise<MemberRegistrationResponse>;
}
