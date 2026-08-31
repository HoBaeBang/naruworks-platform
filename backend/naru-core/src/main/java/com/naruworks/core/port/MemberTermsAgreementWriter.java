package com.naruworks.core.port;

import com.naruworks.domain.model.MemberTermsAgreement;
import java.util.List;

public interface MemberTermsAgreementWriter {

    List<MemberTermsAgreement> saveAll(
            List<MemberTermsAgreement> memberTermsAgreements
    );
}
