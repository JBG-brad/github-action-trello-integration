import { setFailed, getInput } from '@actions/core';
import github from '@actions/github';
import {
  getLabelsOfBoard,
  getMembersOfBoard,
  getCardsOfList,
  createCard,
  updateCard,
  getCardAttachments,
  addUrlSourceToCard,
} from './api';
import { validateListExistsOnBoard, boardId } from './utils';

console.log(JSON.stringify(process.env, undefined, 2));
try {
  const action = getInput('action');
  if (!action) {
    throw Error('Action is not set.');
  }

  switch (action) {
    case 'issue_opened_create_card':
      issueOpenedCreateCard();
      break;
    case 'pull_request_event_move_card':
      pullRequestEventMoveCard();
      break;

    default:
      throw Error('Action is not supported: ' + action);
  }
} catch (error) {
  setFailed(error);
}

function issueOpenedCreateCard() {
  try {
    const listId = process.env.TRELLO_LIST_ID;
    validateListExistsOnBoard(listId);
  } catch (error) {
    setFailed(error);
    return;
  }

  const issue = github.context.payload.issue;
  const issueNumber = issue.number;
  const issueTitle = issue.title;
  const issueBody = issue.body;
  const issueUrl = issue.html_url;
  const issueAssigneeNicks = issue.assignees.map((assignee) => assignee.login);
  const issueLabelNames = issue.labels.map((label) => label.name);

  let trelloLabelIds = [];
  let memberIds = [];

  const labels = getLabelsOfBoard(boardId).then(function (response) {
    const trelloLabels = response;
    trelloLabels.filter((trelloLabel) => issueLabelNames.indexof(trelloLabel.name) !== -1);
    trelloLabelIds.push(trelloLabels.map((label) => label.id));
  });

  const members = getMembersOfBoard(boardId).then(function (response) {
    const members = response;
    members.filter((member) => issueAssigneeNicks.indexof(member.username) !== -1);
    memberIds.push(members.map((member) => member.id));
  });

  Promise.all([labels, members]).then(() => {
    const cardParams = {
      number: issueNumber,
      title: issueTitle,
      description: issueBody,
      sourceUrl: issueUrl,
      memberIds: memberIds.join(),
      labelIds: trelloLabelIds.join(),
    };

    createCard(listId, cardParams).then((response) => {
      if (debug)
        console.log(
          `createCard got response:`,
          `Card created: [#${issueNumber}] ${issueTitle}`,
          JSON.stringify(response, undefined, 2),
        );
    });
  });
}

function pullRequestEventMoveCard() {
  try {
    const haystackList = process.env.TRELLO_SOURCE_LIST_ID;
    validateListExistsOnBoard(haystackList);

    const targetList = process.env.TRELLO_TARGET_LIST_ID;
    validateListExistsOnBoard(targetList);

    if (!haystackList || !targetList) {
      throw Error("Trello's source and target list IDs must be present when moving card around.");
    }
  } catch (error) {
    setFailed(error);
    return;
  }
  const pullRequest = context.event.pull_request;

  getMembersOfBoard(boardId)
    .then(function (response) {
      if (process.env.TRELLO_SYNC_BOARD_MEMBERS || false) {
        const prReviewers = pullRequest.requested_reviewers.map((reviewer) => reviewer.login);
        const members = response;
        const additionalMemberIds = [];
        prReviewers.forEach(function (reviewer) {
          members.forEach(function (member) {
            if (member.username == reviewer) {
              additionalMemberIds[member.username] = member.id;
            }
          });
        });
        console.log('Additional members: ' + JSON.stringify(additionalMemberIds, undefined, 2));
      }
    })
    .then(() => {
      getCardsOfList(haystackList).then(function (response) {
        const cards = response;
        const prIssuesReferenced = pullRequest.body.match(/#[1-9][0-9]*/);
        const prUrl = pullRequest.html_url;

        let cardId;
        let existingMemberIds = [];
        cards.some(function (card) {
          const haystack = `${card.name} ${card.desc}`;
          const card_issue_numbers = haystack.match(/#[0-9][1-9]*/);
          if (debug) {
            console.log('card_issue_numbers', JSON.stringify(card_issue_numbers, undefined, 2));
          }
          // card_issue_numbers.forEach((element) => {});
          // if (card_issue_number == prIssuesReferenced) {
          //   cardId = card.id;
          //   existingMemberIds = card.idMembers;
          return false;
          // }
        });
        const cardParams = {
          destinationListId: targetList,
          memberIds: existingMemberIds.concat(additionalMemberIds).join(),
        };

        if (cardId) {
          updateCard(cardId, cardParams).then(function (response) {
            getCardAttachments(cardId).then((response) => {
              console.log('getCardAttachments response: ', JSON.stringify(response, undefined, 2));
            });
            addUrlSourceToCard(cardId, prUrl);
          });
        } else {
          setFailed('Card not found.');
        }
      });
    });
}
