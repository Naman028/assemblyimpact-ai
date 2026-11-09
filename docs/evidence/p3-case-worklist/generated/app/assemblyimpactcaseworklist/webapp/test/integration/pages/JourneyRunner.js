sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"assemblyimpactcaseworklist/test/integration/pages/ReviewCasesList.gen",
	"assemblyimpactcaseworklist/test/integration/pages/ReviewCasesObjectPage.gen"
], function (JourneyRunner, ReviewCasesListGenerated, ReviewCasesObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('assemblyimpactcaseworklist') + '/test/flp.html#app-preview',
        pages: {
			onTheReviewCasesListGenerated: ReviewCasesListGenerated,
			onTheReviewCasesObjectPageGenerated: ReviewCasesObjectPageGenerated
        },
        async: true
    });

    return runner;
});

