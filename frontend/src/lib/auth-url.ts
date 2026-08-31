const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8081";

export function getLoginUrl() {
  return `${apiBaseUrl}/api/auth/login`;
}

export function getInvitationLoginUrl(referralCode: string) {
  const params = new URLSearchParams({ ref: referralCode });

  return `${apiBaseUrl}/api/auth/google?${params.toString()}`;
}
