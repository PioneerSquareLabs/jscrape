const fs = require("fs");
const path = require("path");
const jscrape = require("../jscrape");

/**
 * @description Yield PSL team member detail pages
 */
class TeamMemberCrawler {
    async *crawl(page) {
        const memberLinks = await page.$$(".team-body a");
        for (const memberLink of memberLinks) {
            const memberURL = await memberLink.href();
            const memberPage = await page.browser().tryOpenPage(memberURL);
            if (memberPage != null) {
                yield memberPage;
            }
        }
    }
}

/**
 * @description Extract details about a PSL team member from their detail page
 */
class TeamMemberExtractor {
    async *extract(page) {
        const teamMember = {};

        teamMember.name = await page.cleanText(".text-block-17");
        teamMember.title = await page.cleanText(".text-block-18");

        const imageElement = await page.$(".image-30");
        teamMember.imageUrl = await imageElement.prop("src");

        teamMember.bio = await page.cleanText(".rich-text-block");

        yield teamMember;
    }
}

/**
 * @description Scrape PSL team members
 */
class PSLTeamScraper extends jscrape.Scraper {
    async *process(page, target) {
        const crawler = new TeamMemberCrawler();
        for await (const teamMemberPage of crawler.crawl(page)) {
            const extractor = new TeamMemberExtractor();
            yield* extractor.extract(teamMemberPage);
            await teamMemberPage.close();
        }
    }
}

PSLTeamScraper.targets = [{ url: "https://www.psl.com/team" }];

exports.Scraper = PSLTeamScraper;
